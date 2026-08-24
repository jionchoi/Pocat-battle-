import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  FEED_PAGE_SIZE,
  FEED_PAGE_SIZE_MAX,
  MIN_VIRAL_ROWS,
  TRENDING_COUNT,
  emptyReactions,
  widerWindow,
  windowCutoff,
  type Reaction,
  type ViralWindow,
} from '../game/community.js';
import { serializeFeedPhoto, type AuthorRow } from '../serializers/feedPhoto.js';
import { friendIdsOf } from './friends.js';
import type { PhotoRow } from '../serializers/photo.js';
import { nicknamesFor } from './catNames.js';

/**
 * The community feed, in two orderings.
 *
 * `/feed` is chronological and personal — who you follow, or everyone, newest first.
 * `/feed/viral` is ranked and public, identical for every reader, and served anonymously so a
 * CDN can cache it. Those are different enough to be different endpoints rather than a
 * parameter: one is a timeline and the other is a chart.
 */

/* -------------------------------------------------------------------------- */
/* Shared assembly                                                            */
/* -------------------------------------------------------------------------- */

const PHOTO_COLUMNS = '*';

/**
 * Turns rows into cards: authors, reaction tallies and cat names, in three queries total.
 *
 * Every one of these is a grouped lookup rather than a per-row fetch. A feed page is thirty
 * photographs and the naive version is ninety round trips, which is the difference between a
 * page that renders and one that times out.
 *
 * `viewerId` is null on the ranked feed, which is served anonymously on purpose — see the note
 * in the client's `endpoints.ts`. The consequence is that `myReaction` comes back null on every
 * card, and that is not missing data: it is *this reader's own action*, which the client
 * already knows and overlays from `reactionStore`.
 */
export async function assembleFeedCards(rows: PhotoRow[], viewerId: string | null) {
  if (rows.length === 0) return [];

  const photoIds = rows.map((row) => row.id);
  const ownerIds = [...new Set(rows.map((row) => row.owner_id))];

  const [authors, tallies, names] = await Promise.all([
    authorsFor(ownerIds),
    talliesFor(photoIds, viewerId),
    viewerId ? nicknamesFor(viewerId, rows.map((r) => r.cat_id).filter((id): id is string => id !== null)) : null,
  ]);

  return rows.map((row) =>
    serializeFeedPhoto(
      row,
      authors.get(row.owner_id) ?? null,
      tallies.get(row.id) ?? { reactions: emptyReactions(), myReaction: null },
      /*
       * The *reader's* name for the cat, not the owner's.
       *
       * Which is almost always nothing, and that is right: a nickname is one player's private
       * label for an animal, and showing a stranger's to everyone would publish it. The owner
       * reading their own photo in the feed sees theirs, because they have a Dex entry for it.
       */
      row.cat_id ? (names?.get(row.cat_id) ?? null) : null
    )
  );
}

async function authorsFor(ownerIds: readonly string[]): Promise<Map<string, AuthorRow>> {
  if (ownerIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, player_stats ( rank )')
    .in('id', ownerIds);

  if (error) throw error;

  const map = new Map<string, AuthorRow>();

  for (const row of data ?? []) {
    // PostgREST types a to-one embed as an array when it cannot prove the cardinality.
    const stats = row.player_stats as { rank: number }[] | { rank: number } | null;
    const rank = (Array.isArray(stats) ? stats[0] : stats)?.rank ?? 1;

    map.set(row.id as string, {
      id: row.id as string,
      username: row.username as string | null,
      avatar_url: row.avatar_url as string | null,
      rank,
    });
  }

  return map;
}

/** Per-kind reaction counts for a page, and the reader's own where there is a reader. */
async function talliesFor(
  photoIds: readonly string[],
  viewerId: string | null
): Promise<Map<string, { reactions: Record<Reaction, number>; myReaction: Reaction | null }>> {
  const { data, error } = await supabase
    .from('votes')
    .select('photo_id, reaction, voter_id')
    .in('photo_id', photoIds);

  if (error) throw error;

  const map = new Map<string, { reactions: Record<Reaction, number>; myReaction: Reaction | null }>();

  for (const row of (data ?? []) as { photo_id: string; reaction: Reaction; voter_id: string }[]) {
    let entry = map.get(row.photo_id);
    if (!entry) {
      entry = { reactions: emptyReactions(), myReaction: null };
      map.set(row.photo_id, entry);
    }

    entry.reactions[row.reaction] += 1;
    if (viewerId && row.voter_id === viewerId) entry.myReaction = row.reaction;
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/* The chronological feed                                                     */
/* -------------------------------------------------------------------------- */

export interface FeedQuery {
  scope: 'everyone' | 'friends';
  cursor?: string;
  limit?: number;
}

/**
 * Newest shared photographs first.
 *
 * Keyset paged on `(created_at, id)`, the same shape the album uses and for the same reason:
 * a feed grows at the head, so an offset would show a duplicate row for every photograph
 * shared while somebody was reading.
 */
export async function listFeed(viewerId: string, query: FeedQuery) {
  const limit = Math.min(Math.max(query.limit ?? FEED_PAGE_SIZE, 1), FEED_PAGE_SIZE_MAX);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  let builder = supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('shared_to_feed', true);

  if (query.scope === 'friends') {
    const friendIds = await friendIdsOf(viewerId);

    /*
     * No friends is an empty page, not an error — and it is a *correct* empty page now that
     * friendships exist, where before this scope answered 501 because "nothing from friends"
     * and "friends are not built" were indistinguishable. The client's own empty state says
     * "Nothing from friends yet", which is exactly true.
     *
     * Returning early also avoids sending PostgREST an empty `in.()`, which is a syntax error
     * rather than an empty result.
     */
    if (friendIds.length === 0) return { photos: [], nextCursor: null };

    // Their own work is not in their friends feed. It is in their album, and a scope called
    // "friends" that included you would make the two tabs differ by one confusing row.
    builder = builder.in('owner_id', friendIds);
  }

  if (cursor) {
    builder = builder.or(
      `created_at.lt."${cursor.t}",and(created_at.eq."${cursor.t}",id.lt."${cursor.id}")`
    );
  }

  // One more than asked for, purely to answer "is there a page after this".
  const { data, error } = await builder
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (error) throw error;

  const rows = (data ?? []) as PhotoRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    photos: await assembleFeedCards(page, viewerId),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ t: (last as unknown as { created_at: string }).created_at, id: last.id })
        : null,
  };
}

type Cursor = { t: string; id: string };

/*
 * A cursor is echoed back into a PostgREST filter expression, so its parts are syntax.
 *
 * `decodeCursor` used to accept any two strings, and both call sites interpolate them into an
 * `.or(...)` — `captured_at.lt."<t>",and(captured_at.eq."<t>",id.lt."<id>")`. A quote in either
 * value closes the quoted literal and everything after it is read as more filter. The base
 * filter on the statement (`owner_id` here, `shared_to_feed` on the feed) is a separate
 * top-level parameter and is ANDed, so this could not reach another player's rows — but
 * "contained by a filter somebody might later remove" is not the same as "checked".
 *
 * A cursor is not user input in any honest sense: it is a value this server encoded, handed
 * out, and is being given back. So it is validated against the shapes it was minted from —
 * a timestamp and a UUID — and neither can contain a quote.
 */
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/;
const CURSOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKeyset(t: unknown, id: unknown): boolean {
  return (
    typeof t === 'string' && CURSOR_TS_RE.test(t) &&
    typeof id === 'string' && CURSOR_ID_RE.test(id)
  );
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (isKeyset(parsed.t, parsed.id)) {
      return { t: parsed.t as string, id: parsed.id as string };
    }
  } catch {
    // Falls through to the same refusal as a well-formed cursor carrying the wrong shape.
  }

  // A silent first page would turn a paging bug into an infinite scroll that never advances.
  throw new HttpError(400, 'That page of the feed could not be loaded. Pull to refresh.');
}

/* -------------------------------------------------------------------------- */
/* The ranked feed                                                            */
/* -------------------------------------------------------------------------- */

export interface ViralQuery {
  window: ViralWindow;
  offset?: number;
  limit?: number;
}

/**
 * The chart.
 *
 * Offset-paged rather than keyset, deliberately: a rank is a position in a computed ordering
 * and `community_score` moves while somebody is reading, so there is no stable row to key
 * from. The client's `ViralQuery` says the same thing in its own comment.
 *
 * Widens its window rather than showing an empty page. A young product asked for "today"
 * would otherwise answer with nothing, which reads as broken software rather than a quiet day
 * — and the response names the window it actually used, so the client can say so.
 */
export async function viralFeed(viewerId: string | null, query: ViralQuery) {
  const limit = Math.min(Math.max(query.limit ?? FEED_PAGE_SIZE, 1), FEED_PAGE_SIZE_MAX);
  const offset = Math.max(0, query.offset ?? 0);

  let window = query.window;
  let rows = await rankedRows(window, offset, limit + 1);

  /*
   * Only widen on the first page. Widening mid-scroll would re-rank everything under the
   * reader's finger and hand them a page from a different ordering than the one they started.
   */
  while (offset === 0 && rows.length < MIN_VIRAL_ROWS) {
    const wider = widerWindow(window);
    if (!wider) break;

    window = wider;
    rows = await rankedRows(window, offset, limit + 1);
  }

  const page = rows.slice(0, limit);
  const photos = await assembleFeedCards(page, viewerId);

  return {
    /*
     * The rail, and empty on every page but the first — it is the top of the chart, and a
     * chart has one top. The client's `ViralPage` documents the same expectation.
     */
    trending: offset === 0 ? photos.slice(0, TRENDING_COUNT) : [],
    rising: offset === 0 ? photos.slice(TRENDING_COUNT) : photos,
    window,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

/**
 * Ordered by the community's verdict, then by recency.
 *
 * `featured` comes first of all, which is the cold-start lever: a young feed has no engagement
 * to rank on, so somebody with database access can put a good photograph at the top until
 * there is enough real signal to do it honestly.
 */
async function rankedRows(
  window: ViralWindow,
  offset: number,
  take: number
): Promise<PhotoRow[]> {
  const cutoff = windowCutoff(window);

  let builder = supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('shared_to_feed', true);

  if (cutoff) builder = builder.gte('created_at', cutoff);

  const { data, error } = await builder
    .order('featured', { ascending: false })
    .order('community_score', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + take - 1);

  if (error) throw error;

  return (data ?? []) as PhotoRow[];
}
