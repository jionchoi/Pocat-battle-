import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ALBUM_PAGE_SIZE, ALBUM_PAGE_SIZE_MAX } from '../game/album.js';
import { serializePhoto, type PhotoRow } from '../serializers/photo.js';
import { catIdsMatchingNickname, nicknamesFor } from './catNames.js';

/**
 * The album.
 *
 * Everything the player has ever photographed, filtered and paged. It is the only screen
 * that reads a player's whole history, so it is the only one where paging is load-bearing
 * rather than a formality — a two-year-old account is thousands of rows and a phone will
 * ask for them thirty at a time forever.
 */

export interface AlbumQuery {
  userId: string;
  tier?: string;
  search?: string;
  catId?: string;
  sort: 'recent' | 'score';
  cursor?: string;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/* The cursor                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Two paging strategies behind one opaque string, chosen by the sort.
 *
 * The client treats `nextCursor` as a token it hands back, which is what allows this to
 * differ per sort without the app knowing. It differs because the two orderings have
 * genuinely different failure modes:
 *
 *   recent — keyed on `(captured_at, id)`. The album grows at the *head*: taking a photo
 *            mid-scroll shifts every offset by one, and an offset-paged album would show
 *            the reader a duplicate row for every capture. A keyset cursor names the last
 *            row seen, so nothing captured afterwards can disturb the page after it.
 *
 *   score  — an offset. `score_total` is nullable (an unscored photo has no score at all)
 *            and a keyset over a nullable column has to encode "past the nulls too", which
 *            is a second cursor shape to get subtly wrong. A revealed score does insert
 *            itself mid-ordering and can shift a row across a page boundary — the same
 *            trade the ranked feed already accepts for the same reason, see `ViralQuery`
 *            in the client's endpoints.ts.
 *
 * Both are base64url so nothing in them can be mistaken for a query-string delimiter.
 */
type Cursor = { t: string; id: string } | { o: number };

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

/**
 * A cursor the client did not get from us is a 400, not a crash and not a silent first page.
 *
 * Silently starting over would be the friendlier-looking choice and the worse one: an album
 * that answers a corrupt cursor with page one turns a paging bug into an infinite scroll
 * that never advances, and nothing in the logs says why.
 */
function decodeCursor(raw: string): Cursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'That page of your album could not be loaded. Pull to refresh.');
  }

  const value = parsed as Partial<Record<'t' | 'id' | 'o', unknown>>;

  if (typeof value?.o === 'number' && Number.isInteger(value.o) && value.o >= 0) {
    return { o: value.o };
  }

  if (isKeyset(value?.t, value?.id)) {
    return { t: value.t as string, id: value.id as string };
  }

  throw new HttpError(400, 'That page of your album could not be loaded. Pull to refresh.');
}

/* -------------------------------------------------------------------------- */
/* The listing                                                                */
/* -------------------------------------------------------------------------- */

export async function listAlbum(query: AlbumQuery) {
  const limit = Math.min(Math.max(query.limit ?? ALBUM_PAGE_SIZE, 1), ALBUM_PAGE_SIZE_MAX);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  let builder = supabase.from('photos').select('*').eq('owner_id', query.userId);

  if (query.tier) builder = builder.eq('tier', query.tier);
  if (query.catId) builder = builder.eq('cat_id', query.catId);

  if (query.search) {
    const catIds = await catIdsMatchingNickname(query.userId, query.search);

    // Nothing matched, so nothing can. Returning early also avoids sending PostgREST an
    // empty `in.()`, which is a syntax error rather than an empty result.
    if (catIds.length === 0) return { photos: [], nextCursor: null };

    builder = builder.in('cat_id', catIds);
  }

  /*
   * One row more than asked for, and it is never returned.
   *
   * Its only job is to answer "is there a page after this one", which is otherwise
   * unanswerable without a second count query — and a count over a filtered album is the
   * expensive half of the request. A full page with nothing behind it would otherwise
   * hand back a cursor that leads to an empty page.
   */
  const probe = limit + 1;

  if (query.sort === 'score') {
    const offset = cursor && 'o' in cursor ? cursor.o : 0;

    builder = builder
      // Unscored photos sort last rather than first. Postgres orders nulls first on a
      // descending sort, which without this would open the album's best-first view on
      // every photo that has no score yet.
      .order('score_total', { ascending: false, nullsFirst: false })
      .order('captured_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + probe - 1);

    const { data, error } = await builder;
    if (error) throw error;

    const rows = (data ?? []) as PhotoRow[];
    const page = rows.slice(0, limit);

    return {
      photos: await serializePage(query.userId, page),
      nextCursor: rows.length > limit ? encodeCursor({ o: offset + limit }) : null,
    };
  }

  if (cursor && 't' in cursor) {
    /*
     * Strictly after the last row of the previous page, in the composite ordering.
     *
     * The `id` half is not paranoia: `captured_at` comes off the phone's clock and a burst
     * of captures can share a millisecond. Comparing on the timestamp alone would drop
     * every row that ties with the last one on the page.
     */
    builder = builder.or(
      `captured_at.lt."${cursor.t}",and(captured_at.eq."${cursor.t}",id.lt."${cursor.id}")`
    );
  }

  const { data, error } = await builder
    .order('captured_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(probe);

  if (error) throw error;

  const rows = (data ?? []) as PhotoRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    photos: await serializePage(query.userId, page),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ t: last.captured_at, id: last.id })
        : null,
  };
}

/** One nickname lookup for the whole page, rather than one per photo. */
async function serializePage(userId: string, rows: PhotoRow[]) {
  const names = await nicknamesFor(
    userId,
    rows.map((row) => row.cat_id).filter((id): id is string => id !== null)
  );

  return rows.map((row) => serializePhoto(row, row.cat_id ? (names.get(row.cat_id) ?? null) : null));
}
