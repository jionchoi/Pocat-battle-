import { prisma } from '../db/client';
import { COMMUNITY, VIRAL, communityScore, hotScore } from '../game/rules';
import { logger } from '../logger';
import { store, type PipelineOp } from '../redis';
import { serializePhotoWithAuthor } from '../serializers/photo';

/**
 * The viral feed.
 *
 * ## The shape of the problem
 *
 * At the scale this is built for, the feed request is the single most-served endpoint in
 * the product — every app open, every pull-to-refresh, every return from background. It is
 * also, and this is the part that makes it tractable, **the same answer for everybody**.
 * A ranking is global. Computing it per request means computing one identical answer a
 * hundred thousand times.
 *
 * So the whole design is three statements:
 *
 *  1. The score never changes with the clock (`hotScore` in rules.ts), so an ordering can
 *     be stored instead of computed.
 *  2. The page is identical for all viewers, so it is built once per refresh interval and
 *     read from cache by everyone else. No per-user fields go in it — that is what lets it
 *     be cached at the CDN as well, where 100k concurrent readers cost one origin request
 *     every fifteen seconds.
 *  3. Counters live in Redis and reach Postgres through a write-behind job, so the read
 *     path never touches the database and the write path never does an aggregate.
 *
 * ## Request cost
 *
 *   cache hit   ->  1 Redis GET.                    (the overwhelming majority)
 *   stale hit   ->  1 Redis GET, rebuild off-path.
 *   cold build  ->  1 ZREVRANGE + 1 indexed Postgres read of `limit` rows.
 *
 * Postgres sees no per-request load at all, which is the entire point.
 */

/* -------------------------------------------------------------------------- */
/* Keys                                                                       */
/* -------------------------------------------------------------------------- */

export type ViralWindow = 'today' | 'week' | 'all';

const WINDOW_SECONDS: Record<ViralWindow, number | null> = {
  today: 24 * 3600,
  week: 7 * 24 * 3600,
  all: null,
};

const KEY = {
  /** ZSET photoId -> hotScore, one per window. The ranking itself. */
  rank: (window: ViralWindow) => `v:z:${window}`,
  /** ZSET photoId -> capturedAt epoch seconds. Only the trim job reads it. */
  byTime: 'v:t',
  /** HASH of live counters for one photo. */
  counters: (photoId: string) => `v:c:${photoId}`,
  /** HyperLogLog of unique viewers for one photo. */
  viewers: (photoId: string) => `v:pv:${photoId}`,
  /** SET of photo ids whose Redis counters have drifted from their Postgres row. */
  dirty: 'v:dirty',
  /** Serialized page body. */
  page: (window: ViralWindow, offset: number) => `v:page:${window}:${offset}`,
  /** Presence means the page above is fresh; absence means it is stale but servable. */
  fresh: (window: ViralWindow, offset: number) => `v:fresh:${window}:${offset}`,
  /** Held by whichever process is rebuilding a stale page. */
  lock: (window: ViralWindow, offset: number) => `v:lock:${window}:${offset}`,
};

export const CACHE = {
  /**
   * How long a page is served without rebuilding.
   *
   * This number is the ratio between what the feed costs and how live it feels, and 15
   * seconds is far below the interval at which a human perceives a ranking as stale. At
   * 100k concurrent it is also the difference between ~4 origin builds a minute and
   * ~400,000.
   */
  freshSeconds: 15,
  /**
   * How long a stale page remains servable while a rebuild runs.
   *
   * Without this window, every expiry is a thundering herd: a hundred thousand readers
   * arrive at an empty key simultaneously and every one of them starts the same rebuild.
   * Serving stale for a minute means exactly one process rebuilds and nobody waits.
   */
  staleSeconds: 120,
  /** Counter and viewer keys outlive the ranking window they can appear in, then go. */
  counterTtlSeconds: 10 * 24 * 3600,
} as const;

/** Photos in the trending rail. Five fits a phone's width at a legible card size. */
export const RAIL_SIZE = 5;

/** A window needs this many ranked photos before it is worth showing on its own. */
const MIN_RANKED = 6;

/* -------------------------------------------------------------------------- */
/* Hot-set tracking for adaptive view sampling                                */
/* -------------------------------------------------------------------------- */

/**
 * View counts for the photos currently in circulation.
 *
 * Impression recording wants to sample the photos that are expensive and count the rest
 * exactly — but deciding that per request would need a read, and a read per photo per
 * impression batch is precisely the cost being avoided.
 *
 * The observation that makes it free: the photos that are expensive to count are the ones
 * everybody is looking at, and the ones everybody is looking at are the ones in the cached
 * pages this process just built. So the page builder drops their view counts here, and the
 * impression path consults a plain in-memory Map. No round trip, and it covers the head of
 * the distribution, which is where all the cost lives. Photos not in the map are in the
 * long tail and are counted exactly.
 *
 * Per-process and lossy on restart, which is fine — being wrong here costs a little
 * accuracy on one photo's denominator, never correctness.
 */
const circulatingViews = new Map<string, number>();
/** Bounded so a long-running process cannot accumulate every photo ever ranked. */
const CIRCULATING_MAX = 2_000;

export const SAMPLING = {
  /** Below this many views, every viewer is recorded. */
  exactBelowViews: 5_000,
  /** Above it, one viewer in `rate` is recorded and the count is scaled back up. */
  rate: 10,
} as const;

function rememberCirculating(photoId: string, views: number): void {
  if (circulatingViews.size >= CIRCULATING_MAX) {
    // Cheapest possible eviction: drop the oldest insertion. Map preserves insertion
    // order, so this is one delete and no bookkeeping.
    const oldest = circulatingViews.keys().next().value;
    if (oldest !== undefined) circulatingViews.delete(oldest);
  }
  circulatingViews.set(photoId, views);
}

/**
 * Deterministic per-(photo, viewer) sampling.
 *
 * Deterministic rather than random so a viewer who scrolls the same photo past twice
 * cannot be counted on the second pass having been dropped on the first — that would make
 * the sampled count depend on scroll behaviour rather than on audience size.
 */
function isSampledIn(photoId: string, viewerId: string): boolean {
  const views = circulatingViews.get(photoId);
  if (views === undefined || views < SAMPLING.exactBelowViews) return true;

  let hash = 0;
  const key = `${photoId}:${viewerId}`;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }

  return Math.abs(hash) % SAMPLING.rate === 0;
}

/* -------------------------------------------------------------------------- */
/* Read path                                                                  */
/* -------------------------------------------------------------------------- */

export interface ViralPage {
  trending: unknown[];
  rising: unknown[];
  window: ViralWindow;
  nextOffset: number | null;
}

/**
 * Serves a page, building it only when nobody else already has.
 *
 * Returns the JSON string rather than a parsed object: the caller writes it straight to
 * the response, so parsing it here only to re-serialize it there would be pure waste on
 * the hottest path in the product.
 */
export async function getViralPage(
  requested: ViralWindow,
  offset: number,
  limit: number
): Promise<string> {
  const [cached, fresh] = await Promise.all([
    store.get(KEY.page(requested, offset)),
    store.get(KEY.fresh(requested, offset)),
  ]);

  if (cached && fresh) return cached;

  if (cached) {
    // Stale but usable. One process wins the lock and rebuilds; everyone else is served
    // immediately from the copy in hand rather than queuing behind a database read.
    const won = await store.setIfAbsent(
      KEY.lock(requested, offset),
      '1',
      CACHE.freshSeconds
    );
    if (won) {
      void buildPage(requested, offset, limit).catch((err) =>
        logger.error({ err, window: requested, offset }, 'viral page rebuild failed')
      );
    }
    return cached;
  }

  // Cold: nothing to serve, so this request has to build it.
  return buildPage(requested, offset, limit);
}

async function buildPage(
  requested: ViralWindow,
  offset: number,
  limit: number
): Promise<string> {
  const { ids, window } = await rankedIds(requested, offset, limit + 1);

  const hasMore = ids.length > limit;
  const pageIds = ids.slice(0, limit);

  const photos = pageIds.length > 0 ? await hydrate(pageIds) : [];
  const railSize = offset === 0 ? Math.min(RAIL_SIZE, photos.length) : 0;

  const body = JSON.stringify({
    trending: photos.slice(0, railSize),
    rising: photos.slice(railSize),
    window,
    nextOffset: hasMore ? offset + pageIds.length : null,
  } satisfies ViralPage);

  await Promise.all([
    store.set(KEY.page(requested, offset), body, CACHE.staleSeconds),
    store.set(KEY.fresh(requested, offset), '1', CACHE.freshSeconds),
  ]);

  return body;
}

/**
 * The ranked id list, from Redis when it is warm and from Postgres when it is not.
 *
 * The Postgres path is not a degraded mode — it is an indexed `ORDER BY hotScore DESC
 * LIMIT n`, which is a few dozen rows off a B-tree. That it exists at all is a consequence
 * of the score being time-invariant, and it is what makes Redis a cache here rather than a
 * system of record: losing the whole instance costs latency for one refresh interval, not
 * data.
 */
async function rankedIds(
  requested: ViralWindow,
  offset: number,
  take: number
): Promise<{ ids: string[]; window: ViralWindow }> {
  const ladder: ViralWindow[] =
    requested === 'today' ? ['today', 'week', 'all'] : requested === 'week' ? ['week', 'all'] : ['all'];

  for (const window of ladder) {
    const ids = await store.zrevrange(KEY.rank(window), offset, take);

    if (ids.length > 0) {
      // Only the first page may widen its window. Paging deeper must not silently jump
      // into a larger set halfway down the wall.
      if (ids.length >= MIN_RANKED || offset > 0 || window === 'all') {
        return { ids, window };
      }
      continue;
    }

    const fallback = await rankedIdsFromDb(window, offset, take);
    if (fallback.length > 0) {
      void warmRankFromDb(window).catch((err) =>
        logger.error({ err, window }, 'viral rank warm failed')
      );
      if (fallback.length >= MIN_RANKED || offset > 0 || window === 'all') {
        return { ids: fallback, window };
      }
    }
  }

  return { ids: [], window: requested };
}

async function rankedIdsFromDb(
  window: ViralWindow,
  offset: number,
  take: number
): Promise<string[]> {
  const seconds = WINDOW_SECONDS[window];

  const rows = await prisma.photo.findMany({
    where: {
      sharedToFeed: true,
      ...(seconds === null
        ? {}
        : { capturedAt: { gte: new Date(Date.now() - seconds * 1000) } }),
    },
    orderBy: [{ hotScore: 'desc' }, { id: 'desc' }],
    skip: offset,
    take,
    select: { id: true },
  });

  return rows.map((row) => row.id);
}

/**
 * Repopulates a cold ranking ZSET from the database.
 *
 * Bounded to the top slice rather than the whole window: nobody pages ten thousand deep
 * into a viral feed, and the ones below that are re-added by the flush job the moment they
 * get any engagement at all.
 */
const WARM_LIMIT = 1_000;

async function warmRankFromDb(window: ViralWindow): Promise<void> {
  const seconds = WINDOW_SECONDS[window];

  const rows = await prisma.photo.findMany({
    where: {
      sharedToFeed: true,
      ...(seconds === null
        ? {}
        : { capturedAt: { gte: new Date(Date.now() - seconds * 1000) } }),
    },
    orderBy: { hotScore: 'desc' },
    take: WARM_LIMIT,
    select: { id: true, hotScore: true, capturedAt: true },
  });

  const ops: PipelineOp[] = [];
  for (const row of rows) {
    ops.push({ op: 'zadd', key: KEY.rank(window), score: row.hotScore, member: row.id });
    ops.push({
      op: 'zadd',
      key: KEY.byTime,
      score: Math.floor(row.capturedAt.getTime() / 1000),
      member: row.id,
    });
  }

  await store.pipeline(ops);
  logger.info({ window, count: rows.length }, 'viral rank warmed from database');
}

/**
 * Turns ids into wire objects, with live counters layered over the stored row.
 *
 * The Postgres row's counters lag by up to one flush interval, so the numbers on the card
 * would visibly lag a reaction the viewer just watched land. Redis holds the current
 * values; this is where the two are reconciled, and it costs one pipelined read.
 *
 * No `viewerId` is passed to the serializer. Every field here is the same for every
 * reader, which is what makes the page cacheable at all — `myReaction` is resolved by the
 * client from its own state.
 */
async function hydrate(ids: string[]) {
  const [rows, counters, viewCounts] = await Promise.all([
    prisma.photo.findMany({
      where: { id: { in: ids } },
      include: {
        cat: true,
        owner: {
          select: { id: true, username: true, avatarUrl: true, photographerRank: true },
        },
      },
    }),
    Promise.all(ids.map((id) => store.hgetall(KEY.counters(id)))),
    store.pfcount(ids.map((id) => KEY.viewers(id))),
  ]);

  // `IN (...)` returns rows in whatever order the planner likes, which would discard the
  // ranking that is the entire point of the query.
  const byId = new Map(rows.map((row) => [row.id, row]));

  return ids
    .map((id, index) => {
      const row = byId.get(id);
      if (!row) return null;

      const live = counters[index] ?? {};
      const laugh = number(live.laugh, row.laughCount);
      const love = number(live.love, row.loveCount);
      const wow = number(live.wow, row.wowCount);
      const views = Math.max(scaleViews(id, viewCounts[index] ?? 0), row.viewCount);

      rememberCirculating(id, views);

      const votes = laugh + love + wow;

      return serializePhotoWithAuthor(
        {
          ...row,
          laughCount: laugh,
          loveCount: love,
          wowCount: wow,
          voteCount: votes,
          viewCount: views,
          communityScore: communityScore({ votes, views }),
        },
        {
          // No viewer. The page is public and identical for everyone; see the note above.
          viewerId: '',
          cat: row.cat,
        }
      );
    })
    .filter((photo): photo is NonNullable<typeof photo> => photo !== null);
}

function number(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Undoes adaptive sampling. See `isSampledIn`. */
function scaleViews(photoId: string, counted: number): number {
  const known = circulatingViews.get(photoId);
  if (known === undefined || known < SAMPLING.exactBelowViews) return counted;
  return counted * SAMPLING.rate;
}

/* -------------------------------------------------------------------------- */
/* Write path                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Records that these viewers saw these photos.
 *
 * This is the highest-volume write in the product by two orders of magnitude — every
 * viewer emits one of these for every photo that crosses their screen — so it does exactly
 * one pipelined Redis round trip and touches Postgres never.
 *
 * What it replaced: a row per (photo, viewer) plus two `COUNT(*)` and an `UPDATE` per
 * photo. That is ~72 queries for one scroll batch, which at feed volume is millions of
 * queries per second and millions of rows per second of storage growth. The exact answer
 * was not worth its price for a number that exists to be a denominator.
 */
export async function recordImpressions(params: {
  viewerId: string;
  photoIds: string[];
}): Promise<{ recorded: number }> {
  const ids = [...new Set(params.photoIds)].slice(0, 100);
  if (ids.length === 0) return { recorded: 0 };

  const ops: PipelineOp[] = [];

  for (const id of ids) {
    if (!isSampledIn(id, params.viewerId)) continue;

    ops.push({
      op: 'pfadd',
      key: KEY.viewers(id),
      value: params.viewerId,
      ttlSeconds: CACHE.counterTtlSeconds,
    });
    ops.push({ op: 'sadd', key: KEY.dirty, member: id });
  }

  await store.pipeline(ops);

  return { recorded: ids.length };
}

/**
 * Applies a reaction delta to the live counters and re-ranks the photo.
 *
 * Reactions are a human act at human frequency — a few per user per session — so unlike
 * impressions this can afford a read. It still does not aggregate: the counters are
 * incremented, not recounted.
 */
export async function applyReactionDelta(params: {
  photoId: string;
  capturedAt: Date;
  deltas: Partial<Record<'laugh' | 'love' | 'wow', number>>;
  fallback: { laugh: number; love: number; wow: number; views: number };
}): Promise<{ laugh: number; love: number; wow: number; views: number; communityScore: number }> {
  const ops: PipelineOp[] = [];

  for (const [field, amount] of Object.entries(params.deltas)) {
    if (!amount) continue;
    ops.push({
      op: 'hincrby',
      key: KEY.counters(params.photoId),
      field,
      amount,
      ttlSeconds: CACHE.counterTtlSeconds,
    });
  }
  ops.push({ op: 'sadd', key: KEY.dirty, member: params.photoId });

  await store.pipeline(ops);

  const [live, [viewers]] = await Promise.all([
    store.hgetall(KEY.counters(params.photoId)),
    store.pfcount([KEY.viewers(params.photoId)]),
  ]);

  const laugh = number(live.laugh, params.fallback.laugh);
  const love = number(live.love, params.fallback.love);
  const wow = number(live.wow, params.fallback.wow);
  const views = Math.max(scaleViews(params.photoId, viewers ?? 0), params.fallback.views);
  const votes = laugh + love + wow;
  const score = communityScore({ votes, views });

  await rerank({
    photoId: params.photoId,
    capturedAt: params.capturedAt,
    reactions: votes,
    views,
    communityScore: score,
  });

  return { laugh, love, wow, views, communityScore: score };
}

/**
 * Writes a photo's position into every ranking window it belongs to.
 *
 * `ZADD` is O(log N) and idempotent, so this is safe to call from the reaction path, the
 * flush job and the capture path alike.
 */
export async function rerank(params: {
  photoId: string;
  capturedAt: Date;
  reactions: number;
  views: number;
  communityScore: number;
}): Promise<number> {
  const score = hotScore({
    reactions: params.reactions,
    views: params.views,
    communityScore: params.communityScore,
    capturedAt: params.capturedAt,
  });

  const ageSeconds = (Date.now() - params.capturedAt.getTime()) / 1000;
  const ops: PipelineOp[] = [
    { op: 'zadd', key: KEY.rank('all'), score, member: params.photoId },
    {
      op: 'zadd',
      key: KEY.byTime,
      score: Math.floor(params.capturedAt.getTime() / 1000),
      member: params.photoId,
    },
  ];

  for (const window of ['today', 'week'] as const) {
    const limit = WINDOW_SECONDS[window];
    if (limit !== null && ageSeconds <= limit) {
      ops.push({ op: 'zadd', key: KEY.rank(window), score, member: params.photoId });
    }
  }

  await store.pipeline(ops);
  return score;
}

/** Removes a photo from every ranking. Called on delete and on unshare. */
export async function unrank(photoId: string): Promise<void> {
  await store.pipeline([
    { op: 'zrem', key: KEY.rank('today'), member: photoId },
    { op: 'zrem', key: KEY.rank('week'), member: photoId },
    { op: 'zrem', key: KEY.rank('all'), member: photoId },
    { op: 'zrem', key: KEY.byTime, member: photoId },
  ]);
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

/** Photos drained from the dirty set per flush. Bounds one job run's cost. */
const FLUSH_BATCH = 500;

/**
 * Write-behind: pushes Redis counters into Postgres.
 *
 * Postgres is the durable record, not the working set. Reactions and views land in Redis
 * at request time and are reconciled here on a schedule, which converts millions of small
 * writes into one bulk statement a minute. The cost of a crash is up to one interval of
 * counter drift on photos that were being looked at, which the next impression or reaction
 * corrects anyway.
 *
 * `SPOP` drains the set atomically, so two API instances running this job cannot both
 * claim the same photo.
 */
export async function flushCounters(): Promise<{ flushed: number }> {
  const ids = await store.spop(KEY.dirty, FLUSH_BATCH);
  if (ids.length === 0) return { flushed: 0 };

  const [rows, counters, viewCounts] = await Promise.all([
    prisma.photo.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        capturedAt: true,
        laughCount: true,
        loveCount: true,
        wowCount: true,
        viewCount: true,
        sharedToFeed: true,
      },
    }),
    Promise.all(ids.map((id) => store.hgetall(KEY.counters(id)))),
    store.pfcount(ids.map((id) => KEY.viewers(id))),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const updates: {
    id: string;
    laugh: number;
    love: number;
    wow: number;
    votes: number;
    views: number;
    score: number;
    hot: number;
  }[] = [];

  ids.forEach((id, index) => {
    const row = byId.get(id);
    if (!row) return;

    const live = counters[index] ?? {};
    const laugh = number(live.laugh, row.laughCount);
    const love = number(live.love, row.loveCount);
    const wow = number(live.wow, row.wowCount);
    // Counters only ever move forward here; a Redis eviction must not roll a stored
    // count backwards to zero.
    const views = Math.max(scaleViews(id, viewCounts[index] ?? 0), row.viewCount);
    const votes = laugh + love + wow;
    const score = communityScore({ votes, views });

    updates.push({
      id,
      laugh,
      love,
      wow,
      votes,
      views,
      score,
      hot: hotScore({
        reactions: votes,
        views,
        communityScore: score,
        capturedAt: row.capturedAt,
      }),
    });
  });

  if (updates.length === 0) return { flushed: 0 };

  // One statement for the whole batch. Five hundred individual UPDATEs would be five
  // hundred round trips and five hundred transactions for what is one page of rows.
  await prisma.$executeRawUnsafe(
    `UPDATE "Photo" AS p SET
       "laughCount"     = v.laugh,
       "loveCount"      = v.love,
       "wowCount"       = v.wow,
       "voteCount"      = v.votes,
       "viewCount"      = v.views,
       "communityScore" = v.score,
       "hotScore"       = v.hot
     FROM (VALUES ${updates
       .map(
         (_, i) =>
           `($${i * 8 + 1}, $${i * 8 + 2}::int, $${i * 8 + 3}::int, $${i * 8 + 4}::int, $${
             i * 8 + 5
           }::int, $${i * 8 + 6}::int, $${i * 8 + 7}::int, $${i * 8 + 8}::double precision)`
       )
       .join(', ')})
       AS v(id, laugh, love, wow, votes, views, score, hot)
     WHERE p.id = v.id`,
    ...updates.flatMap((u) => [u.id, u.laugh, u.love, u.wow, u.votes, u.views, u.score, u.hot])
  );

  // Keep the ranking in step with what was just written, so a photo whose numbers moved
  // while it sat in the dirty set does not wait for its next reaction to be re-placed.
  await Promise.all(
    updates.map((update) => {
      const row = byId.get(update.id);
      if (!row || !row.sharedToFeed) return unrank(update.id);
      return rerank({
        photoId: update.id,
        capturedAt: row.capturedAt,
        reactions: update.votes,
        views: update.views,
        communityScore: update.score,
      }).then(() => undefined);
    })
  );

  return { flushed: updates.length };
}

/**
 * Drops photos out of the bounded windows once they age past them.
 *
 * The `all` ranking keeps everything — decay handles it there. `today` and `week` are
 * membership windows, and membership is the one thing a static score cannot express, so it
 * is trimmed on a schedule from the time index rather than filtered on read.
 */
export async function trimWindows(): Promise<{ removed: number }> {
  const now = Math.floor(Date.now() / 1000);
  let removed = 0;

  for (const window of ['today', 'week'] as const) {
    const seconds = WINDOW_SECONDS[window];
    if (seconds === null) continue;

    const cutoff = now - seconds;
    const expired = await store.zrangebyscore(KEY.byTime, 0, cutoff);
    if (expired.length === 0) continue;

    await store.pipeline(
      expired.map((photoId) => ({ op: 'zrem' as const, key: KEY.rank(window), member: photoId }))
    );
    removed += expired.length;
  }

  // Anything older than the widest bounded window no longer needs a time entry; the
  // `all` ranking does not consult it.
  const widest = WINDOW_SECONDS.week ?? 0;
  await store.zremrangebyscore(KEY.byTime, 0, now - widest);

  return { removed };
}

/** Exposed for the capture path, which ranks a photo the moment it is shared. */
export { KEY as VIRAL_KEYS, COMMUNITY as VIRAL_COMMUNITY, VIRAL as VIRAL_TUNING };
