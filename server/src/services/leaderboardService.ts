import { prisma } from '../db/client';
import { errors } from '../errors';
import { COMMUNITY, LEADERBOARD_CONFIG } from '../game/rules';
import { logger } from '../logger';
import { neighborhoodBucket } from './mapService';
import { friendIdsFor } from './feedService';

/**
 * Leaderboards (README sections 5.4 and 9.5).
 *
 * Computed by a scheduled job into `LeaderboardSnapshot`, never aggregated live per
 * request. Ranking every player on every leaderboard view is the kind of thing that is
 * fine at 200 users and takes the site down at 20,000.
 */

export type Scope = 'neighborhood' | 'city' | 'global' | 'friends';
export type Metric = 'community' | 'votesReceived' | 'challengeWins' | 'topPhoto';

const SCOPES: Scope[] = ['neighborhood', 'city', 'global', 'friends'];
const METRICS: Metric[] = ['community', 'votesReceived', 'challengeWins', 'topPhoto'];

/** The global board is one bucket shared by everyone. */
const GLOBAL_BUCKET = 'global';

export function parseScope(raw: unknown): Scope {
  if (typeof raw === 'string' && SCOPES.includes(raw as Scope)) return raw as Scope;
  return 'neighborhood';
}

export function parseMetric(raw: unknown): Metric {
  if (typeof raw === 'string' && METRICS.includes(raw as Metric)) return raw as Metric;
  // Community reception is the headline board — the app's own opinion of a photo is a
  // secondary tab, not the default ranking.
  return 'community';
}

/**
 * Read a precomputed board.
 *
 * Friends is the exception: it is per-viewer and cheap (bounded by the friend list), so
 * it is computed on read rather than stored as a snapshot per user.
 */
export async function readLeaderboard(params: {
  userId: string;
  scope: Scope;
  metric: Metric;
  limit?: number;
}) {
  const limit = Math.min(100, Math.max(5, params.limit ?? 50));

  if (params.scope === 'friends') {
    return friendsLeaderboard(params.userId, params.metric, limit);
  }

  const bucket = await bucketForUser(params.userId, params.scope);
  if (!bucket) {
    // No home location set yet, so there is no neighbourhood to rank within. The screen
    // renders its empty state rather than showing a misleading global board.
    return { entries: [], bucket: null, computedAt: null };
  }

  const rows = await prisma.leaderboardSnapshot.findMany({
    where: { scope: params.scope, metric: params.metric, bucket },
    orderBy: { rank: 'asc' },
    take: limit,
  });

  return {
    bucket,
    computedAt: rows[0]?.computedAt ?? null,
    entries: rows.map((r) => ({
      rank: r.rank,
      userId: r.userId,
      username: r.username,
      avatarUrl: r.avatarUrl,
      value: r.value,
      isSelf: r.userId === params.userId,
      topPhotoUrl: r.topPhotoUrl,
    })),
  };
}

async function friendsLeaderboard(userId: string, metric: Metric, limit: number) {
  const ids = new Set<string>([userId, ...(await friendIdsFor(userId))]);

  const rows = await metricValues([...ids]);

  const entries = rows
    .map((r) => ({ ...r, value: r[metric] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((r, index) => ({
      rank: index + 1,
      userId: r.userId,
      username: r.username,
      avatarUrl: r.avatarUrl,
      value: r.value,
      isSelf: r.userId === userId,
      topPhotoUrl: r.topPhotoUrl,
    }));

  return { entries, bucket: 'friends', computedAt: new Date() };
}

interface MetricRow {
  userId: string;
  username: string;
  avatarUrl: string;
  topPhotoUrl: string | null;
  /** Best Bayesian-smoothed engagement ratio, 0..1000. The real standing. */
  community: number;
  /** Reactions received in the window. */
  votesReceived: number;
  challengeWins: number;
  /** Best instant algorithmic score — the app's opinion, kept as a secondary board. */
  topPhoto: number;
}

/**
 * One pass over the users we care about, returning all three metrics.
 *
 * Grouped aggregates rather than a per-user query — N+1 here would mean one query per
 * player on the board, on a job that runs over the whole user table.
 *
 * Every metric is windowed to the last 30 days so the boards stay winnable: a lifetime
 * board is permanently owned by whoever started first.
 *
 * The community metric only counts photos with enough unique viewers to be meaningful.
 * Without that floor the board would be topped by photos two friends saw and both
 * reacted to — the smoothing keeps the *score* honest, but a confidence floor is what
 * keeps the *board* honest.
 */
async function metricValues(userIds?: string[]): Promise<MetricRow[]> {
  const since = new Date(
    Date.now() - LEADERBOARD_CONFIG.windowDays * 24 * 3600 * 1000
  );

  const users = await prisma.user.findMany({
    where: userIds ? { id: { in: userIds } } : {},
    select: { id: true, username: true, avatarUrl: true },
  });

  const ids = users.map((u) => u.id);
  if (ids.length === 0) return [];

  const [aggregates, community, wins, topPhotos] = await Promise.all([
    prisma.photo.groupBy({
      by: ['ownerId'],
      where: { ownerId: { in: ids }, capturedAt: { gte: since } },
      _max: { total: true },
      _sum: { voteCount: true },
    }),
    // Community standing is the best *confidently scored* photo, not an average — one
    // shot that genuinely landed is the achievement, and averaging would punish anyone
    // who posts often.
    prisma.photo.groupBy({
      by: ['ownerId'],
      where: {
        ownerId: { in: ids },
        capturedAt: { gte: since },
        sharedToFeed: true,
        viewCount: { gte: COMMUNITY.minViewsForConfidence },
      },
      _max: { communityScore: true },
    }),
    prisma.challenge.findMany({
      where: { winningPhotoId: { not: null }, endsAt: { gte: since } },
      select: { winningPhoto: { select: { ownerId: true } } },
    }),
    // The single best-received photo per player in the window, for the row thumbnail.
    prisma.photo.findMany({
      where: { ownerId: { in: ids }, capturedAt: { gte: since } },
      orderBy: [{ communityScore: 'desc' }, { total: 'desc' }],
      select: { ownerId: true, imageUrl: true },
    }),
  ]);

  const aggByUser = new Map(aggregates.map((a) => [a.ownerId, a]));
  const communityByUser = new Map(community.map((c) => [c.ownerId, c]));

  const winsByUser = new Map<string, number>();
  for (const win of wins) {
    const owner = win.winningPhoto?.ownerId;
    if (owner) winsByUser.set(owner, (winsByUser.get(owner) ?? 0) + 1);
  }

  const topPhotoByUser = new Map<string, string>();
  for (const photo of topPhotos) {
    // Ordered by score descending, so the first row per owner is their best.
    if (!topPhotoByUser.has(photo.ownerId)) {
      topPhotoByUser.set(photo.ownerId, photo.imageUrl);
    }
  }

  return users.map((u) => ({
    userId: u.id,
    username: u.username,
    avatarUrl: u.avatarUrl,
    topPhotoUrl: topPhotoByUser.get(u.id) ?? null,
    community: communityByUser.get(u.id)?._max.communityScore ?? 0,
    votesReceived: aggByUser.get(u.id)?._sum.voteCount ?? 0,
    challengeWins: winsByUser.get(u.id) ?? 0,
    topPhoto: aggByUser.get(u.id)?._max.total ?? 0,
  }));
}

async function bucketForUser(userId: string, scope: Scope): Promise<string | null> {
  if (scope === 'global') return GLOBAL_BUCKET;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { homeLat: true, homeLng: true },
  });

  if (user?.homeLat == null || user?.homeLng == null) return null;

  if (scope === 'neighborhood') return neighborhoodBucket(user.homeLat, user.homeLng);

  return cityBucket(user.homeLat, user.homeLng);
}

/**
 * "City" is a coarser cell of the neighbourhood grid (~11km). A real city boundary needs
 * a reverse geocode and a maintained boundary set; a fixed cell is a reasonable stand-in
 * that costs nothing and never goes stale.
 */
export function cityBucket(lat: number, lng: number): string {
  return `${(Math.round(lat / 0.1) * 0.1).toFixed(1)}:${(Math.round(lng / 0.1) * 0.1).toFixed(1)}`;
}

/**
 * The scheduled aggregation. Recomputes every neighbourhood, city and global board.
 *
 * Deletes then re-inserts per bucket inside a transaction so a reader never sees a board
 * that is half old and half new.
 */
export async function recomputeLeaderboards(): Promise<number> {
  const users = await prisma.user.findMany({
    select: { id: true, homeLat: true, homeLng: true },
  });

  if (users.length === 0) return 0;

  const rows = await metricValues(users.map((u) => u.id));
  const rowById = new Map(rows.map((r) => [r.userId, r]));

  const buckets = new Map<string, { scope: Scope; bucket: string; userIds: string[] }>();

  const add = (scope: Scope, bucket: string, userId: string) => {
    const key = `${scope}:${bucket}`;
    const entry = buckets.get(key) ?? { scope, bucket, userIds: [] };
    entry.userIds.push(userId);
    buckets.set(key, entry);
  };

  for (const user of users) {
    // Everyone is on the global board; only players who shared a home location can be
    // placed on a neighbourhood or city one.
    add('global', GLOBAL_BUCKET, user.id);

    if (user.homeLat == null || user.homeLng == null) continue;

    add('neighborhood', neighborhoodBucket(user.homeLat, user.homeLng), user.id);
    add('city', cityBucket(user.homeLat, user.homeLng), user.id);
  }

  let written = 0;

  for (const { scope, bucket, userIds } of buckets.values()) {
    for (const metric of METRICS) {
      const ranked = userIds
        .map((id) => rowById.get(id))
        .filter((r): r is MetricRow => Boolean(r))
        // A player with nothing in the window is left off the board rather than
        // padding it with a wall of zeroes.
        .filter((r) => r[metric] > 0)
        .sort((a, b) => b[metric] - a[metric])
        .slice(0, LEADERBOARD_CONFIG.topN);

      try {
        await prisma.$transaction(async (tx) => {
          await tx.leaderboardSnapshot.deleteMany({ where: { scope, metric, bucket } });

          if (ranked.length === 0) return;

          await tx.leaderboardSnapshot.createMany({
            data: ranked.map((r, index) => ({
              scope,
              metric,
              bucket,
              userId: r.userId,
              username: r.username,
              avatarUrl: r.avatarUrl,
              value: r[metric],
              rank: index + 1,
              topPhotoUrl: metric === 'challengeWins' ? null : r.topPhotoUrl,
            })),
          });
        });

        written += ranked.length;
      } catch (err) {
        logger.error({ err, scope, metric, bucket }, 'leaderboard recompute failed');
      }
    }
  }

  return written;
}

/**
 * Another player's public profile (README section 5.5).
 *
 * Shows only what they chose to showcase, and never a capture location — a stranger's
 * profile must not reveal the street a cat lives on, or where the photographer walks.
 */
export async function publicProfile(userId: string, viewerId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw errors.notFound('That player does not exist.');

  const showcased = await prisma.photo.findMany({
    where: { ownerId: userId, showcased: true },
    orderBy: { total: 'desc' },
    take: 6,
    include: { cat: true, votes: { where: { voterId: viewerId } } },
  });

  // A profile with nothing pinned falls back to their best shared photos, so it is never
  // simply blank for a player who has not discovered the showcase feature.
  const showcasePhotos =
    showcased.length > 0
      ? showcased
      : await prisma.photo.findMany({
          where: { ownerId: userId, sharedToFeed: true },
          orderBy: { total: 'desc' },
          take: 6,
          include: { cat: true, votes: { where: { voterId: viewerId } } },
        });

  const [totalPhotos, catsDiscovered, best, challengeWins] = await Promise.all([
    prisma.photo.count({ where: { ownerId: userId } }),
    prisma.catDexEntry.count({ where: { userId } }),
    prisma.photo.aggregate({ where: { ownerId: userId }, _max: { total: true } }),
    prisma.challenge.count({ where: { winningPhoto: { ownerId: userId } } }),
  ]);

  return {
    user,
    showcasePhotos,
    totalPhotos,
    catsDiscovered,
    bestScore: best._max.total ?? 0,
    challengeWins,
  };
}
