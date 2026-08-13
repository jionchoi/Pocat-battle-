import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { serializePhoto, type PhotoRow } from '../serializers/photo.js';
import {
  serializeCat,
  type CatRow,
  type DexEntryRow,
  type OwnEncounters,
} from '../serializers/cat.js';

/**
 * The Cat Dex.
 *
 * Reading a player's entries, editing one, and the repair work that keeps a tile pointing at
 * a photograph that still exists and is still of the right animal.
 *
 * It started as only that last part, because two very different events need the same repair —
 * deleting a photograph and moving one to another cat both leave an entry pointing at a tile
 * that is no longer right — and `services/photos.ts` and `services/catIdentity.ts` must both
 * be able to call it without importing each other. That constraint still holds and is why
 * nothing here may import either of them.
 *
 * ## Nothing in this file is a cat
 *
 * Every read below answers "what is this player's relationship with this animal", never "what
 * is this animal". A cat is shared and a Dex entry is not, so the join is always filtered on
 * `user_id` first — an entry that is not the caller's is a 404 here rather than a row with
 * somebody else's nickname on it.
 */

/** The columns `CatRow` needs, in one place so the three reads below cannot drift apart. */
const CAT_COLUMNS =
  'id, discovered_by, default_nickname, first_seen_lat, first_seen_lng, last_seen_lat, last_seen_lng, last_seen_at';

/**
 * Hands a cat's Dex tile to the best photo the player has of it.
 *
 * `releasePin` is the whole difference between the two callers, and it is not a preference:
 *
 *   true  — the photograph that *was* the tile is gone or has moved to another cat. The pin
 *           has to be released, because `best_photo_pinned` means "the player chose this one
 *           by hand" and the one they chose is no longer available to choose. Leaving it set
 *           would freeze the tile on a promotion nobody made and block every future score
 *           from ever replacing it.
 *
 *   false — a photograph was *added* to this cat. A pin set by hand outranks a higher score,
 *           which is the entire point of pinning, so a pinned entry is left exactly alone.
 *
 * `encounter_count` is never touched here. It counts times this player met this cat, and no
 * rearrangement of which photograph represents it changes how many times they met it.
 */
export async function promoteBestPhoto(
  userId: string,
  entryId: string,
  catId: string,
  { releasePin }: { releasePin: boolean }
): Promise<void> {
  if (!releasePin) {
    const { data: entry, error: entryError } = await supabase
      .from('cat_dex_entries')
      .select('best_photo_pinned')
      .eq('id', entryId)
      .maybeSingle<{ best_photo_pinned: boolean }>();

    if (entryError) throw entryError;
    // The player picked this tile themselves. A new photograph does not overrule them.
    if (entry?.best_photo_pinned) return;
  }

  const { data: next, error } = await supabase
    .from('photos')
    .select('id, score_total, tier')
    .eq('owner_id', userId)
    .eq('cat_id', catId)
    .not('scored_at', 'is', null)
    .order('score_total', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; score_total: number | null; tier: string | null }>();

  if (error) throw error;

  const changes: Record<string, unknown> = {
    // No photo left is a real state: the player deleted or moved away the only shot they had
    // of this cat. The entry stays — they still met it — and the card falls back to its
    // placeholder.
    best_photo_id: next?.id ?? null,
    best_photo_score: next?.score_total ?? 0,
    best_tier: next?.tier ?? 'Common',
  };

  if (releasePin) changes['best_photo_pinned'] = false;

  const { error: updateError } = await supabase
    .from('cat_dex_entries')
    .update(changes)
    .eq('id', entryId);

  if (updateError) throw updateError;
}

/* -------------------------------------------------------------------------- */
/* What the player's own photographs say                                      */
/* -------------------------------------------------------------------------- */

/** The photo columns an `OwnEncounters` is built from — never the whole row. */
interface EncounterRow {
  id: string;
  cat_id: string;
  storage_path: string;
  captured_lat: number;
  captured_lng: number;
}

/**
 * `OwnEncounters` for many cats at once.
 *
 * The Dex list needs `photoCount`, a tile and the player's own first sighting for every cat
 * they have met, and asking per cat is the N+1 this exists to avoid — a player with forty
 * cats would make forty round trips to draw one grid. One `in` over their own photos answers
 * all of it, and the grouping happens here rather than in the database because the rows are
 * bounded by the album cap and are already being fetched.
 *
 * Takes the entries rather than the ids because the tile is `best_photo_id`, which lives on
 * the entry — and resolving it against rows already filtered to `owner_id` is also what stops
 * an entry pointing at somebody else's photograph from ever producing a URL.
 *
 * Every entry passed in gets an answer. A cat with no photographs left is a real state, not a
 * missing key: deleting the last photo of a cat leaves the entry standing, because the player
 * still met it.
 */
export async function ownEncountersFor(
  userId: string,
  entries: readonly Pick<DexEntryRow, 'cat_id' | 'best_photo_id'>[]
): Promise<Map<string, OwnEncounters>> {
  const catIds = [...new Set(entries.map((entry) => entry.cat_id))];
  if (catIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('photos')
    .select('id, cat_id, storage_path, captured_lat, captured_lng')
    .eq('owner_id', userId)
    .in('cat_id', catIds)
    // Oldest first, so the first row of each group is the player's own first sighting.
    .order('captured_at', { ascending: true });

  if (error) throw error;

  const byCat = new Map<string, EncounterRow[]>();

  for (const row of (data ?? []) as EncounterRow[]) {
    const group = byCat.get(row.cat_id);
    if (group) group.push(row);
    else byCat.set(row.cat_id, [row]);
  }

  const result = new Map<string, OwnEncounters>();

  for (const entry of entries) {
    result.set(entry.cat_id, fromRows(byCat.get(entry.cat_id) ?? [], entry.best_photo_id));
  }

  return result;
}

/**
 * One cat's encounters, from rows the caller already holds.
 *
 * Split out because `dexProfile` fetches that cat's photographs anyway to send them, and
 * running `ownEncountersFor` beside it would be a second query for facts already in hand.
 * Expects the rows oldest-first.
 */
function fromRows(rows: readonly EncounterRow[], bestPhotoId: string | null): OwnEncounters {
  const first = rows[0];

  return {
    photoCount: rows.length,
    bestPhotoPath: rows.find((row) => row.id === bestPhotoId)?.storage_path ?? null,
    firstSeenLocation: first ? { lat: first.captured_lat, lng: first.captured_lng } : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading the Dex                                                            */
/* -------------------------------------------------------------------------- */

/**
 * PostgREST types a to-one embed as an array when it cannot prove the cardinality.
 *
 * Normalised at the edge so nothing downstream has to know, the same way `catNames.ts` does
 * it. Null is not reachable through the foreign key, and is handled rather than asserted
 * because an entry pointing at no cat would otherwise be a `TypeError` inside a serializer
 * instead of one row quietly missing from a grid.
 */
function embeddedCat(value: unknown): CatRow | null {
  const cat = Array.isArray(value) ? value[0] : value;
  return (cat as CatRow | undefined) ?? null;
}

/**
 * Every cat this player has met.
 *
 * Two queries for the whole grid: the entries with their cats embedded, then one pass over
 * the player's photographs of those cats. Ordered by the entry's own `last_seen_at` — the
 * cat's would reorder somebody's Dex when a stranger photographed one of their cats, which
 * is both confusing and a small leak of a capture they cannot see.
 */
export async function listDex(userId: string) {
  const { data, error } = await supabase
    .from('cat_dex_entries')
    .select(`*, cats ( ${CAT_COLUMNS} )`)
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false });

  if (error) throw error;

  const pairs = (data ?? []).flatMap((row) => {
    const cat = embeddedCat((row as { cats?: unknown }).cats);
    return cat ? [{ entry: row as unknown as DexEntryRow, cat }] : [];
  });

  const own = await ownEncountersFor(
    userId,
    pairs.map(({ entry }) => entry)
  );

  return {
    cats: pairs.map(({ entry, cat }) =>
      serializeCat(entry, cat, own.get(entry.cat_id) ?? EMPTY_ENCOUNTERS, userId)
    ),
  };
}

const EMPTY_ENCOUNTERS: OwnEncounters = {
  photoCount: 0,
  bestPhotoPath: null,
  firstSeenLocation: null,
};

/**
 * One cat, with this player's whole history of it.
 *
 * The photographs are not paged. `CatProfile.photos` has no cursor in the client's contract,
 * and it does not need one: a player's shots of a single cat are bounded by the album cap, so
 * the worst case is the album itself rather than an unbounded history.
 */
export async function dexProfile(userId: string, catId: string) {
  const { entry, cat } = await entryWithCat(userId, catId);

  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('owner_id', userId)
    .eq('cat_id', catId)
    // Newest first, which is the order the profile lists them in.
    .order('captured_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as PhotoRow[];

  /*
   * One name for every photograph, resolved once.
   *
   * `nicknamesFor` exists for a page spanning many cats; here there is exactly one, and its
   * name is already in hand from the entry we just read. Calling it would be a query to learn
   * something this function was given.
   */
  const nickname = entry.nickname ?? cat.default_nickname;

  // Oldest-first is what `fromRows` expects, and reversing rows already fetched is cheaper
  // than asking for them twice in two orders.
  const oldestFirst = [...rows].reverse() as unknown as EncounterRow[];

  return {
    cat: serializeCat(entry, cat, fromRows(oldestFirst, entry.best_photo_id), userId),
    photos: rows.map((row) => serializePhoto(row, nickname)),
    encounterLocations: distinctLocations(rows),

    /*
     * The entry's first sighting, not the oldest photograph's.
     *
     * They part company as soon as a player deletes their earliest shot of a cat: the
     * photograph is gone but the meeting still happened, and `encounter_count` deliberately
     * does not fall when a photo is deleted. Taking this from the photographs would quietly
     * rewrite when somebody first met an animal every time they tidied their album.
     */
    firstEncounterAt: entry.first_seen_at,
  };
}

/**
 * Distinct capture locations, for the profile's mini map.
 *
 * Deduplicated on a grid rather than on exact equality. GPS noise means two photographs taken
 * from the same doorstep a week apart never share coordinates, so exact matching would dedupe
 * nothing and draw twenty pins on one spot. Four decimal places is around eleven metres —
 * close enough that two captures inside it were the same place to anybody standing there.
 *
 * No coarsening beyond that. These are the player's own captures being shown to the player,
 * which is the one audience §2's rule does not apply to.
 */
function distinctLocations(rows: readonly PhotoRow[]): { lat: number; lng: number }[] {
  const seen = new Set<string>();
  const out: { lat: number; lng: number }[] = [];

  for (const row of rows) {
    const key = `${row.captured_lat.toFixed(4)},${row.captured_lng.toFixed(4)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({ lat: row.captured_lat, lng: row.captured_lng });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Editing an entry                                                           */
/* -------------------------------------------------------------------------- */

export interface DexPatch {
  nickname?: string;
  /** Empty clears it — see the controller's note on why that is not the same as absent. */
  bio?: string | null;
  bestPhotoId?: string;
  bestPhotoPinned?: false;
}

/**
 * The fields a player owns on their own Dex entry.
 *
 * Mirrors the column grant in the photos-and-cats migration exactly — `nickname`, `bio`,
 * `best_photo_id`, `best_photo_pinned` and nothing else. The grant is what actually stops the
 * app writing `encounter_count`; this is the same boundary drawn a second time on purpose, in
 * the place where a reviewer will read it.
 */
export async function updateDexEntry(userId: string, catId: string, patch: DexPatch) {
  const { entry } = await entryWithCat(userId, catId);

  const changes: Record<string, unknown> = {};

  if (patch.nickname !== undefined) changes['nickname'] = patch.nickname;
  if (patch.bio !== undefined) changes['bio'] = patch.bio;

  if (patch.bestPhotoId !== undefined) {
    /*
     * Two checks, not one.
     *
     * Owning the photograph is not enough — a photo the caller owns but which is of a
     * different animal would put their picture of one cat onto another cat's card, and the
     * Dex would then be showing them the wrong animal under a name they chose themselves.
     * Both conditions are in the query rather than fetched and compared, so there is no
     * window between the two.
     */
    const { data: photo, error } = await supabase
      .from('photos')
      .select('id, score_total, tier')
      .eq('id', patch.bestPhotoId)
      .eq('owner_id', userId)
      .eq('cat_id', catId)
      .maybeSingle<{ id: string; score_total: number | null; tier: string | null }>();

    if (error) throw error;
    if (!photo) throw new HttpError(404, 'That photo is not one of your shots of this cat.');

    changes['best_photo_id'] = photo.id;
    changes['best_photo_pinned'] = true;

    /*
     * The tile's score and tier are copied, and an unscored photograph is allowed to be one.
     *
     * A player may well want the shot they like best rather than the one that scored best,
     * and refusing an unscored photo would mean the tile could not be set until an allowance
     * freed up. It lands as score 0 and tier Common, which is what `promoteBestPhoto` already
     * writes when a cat has no scored photographs left.
     */
    changes['best_photo_score'] = photo.score_total ?? 0;
    changes['best_tier'] = photo.tier ?? 'Common';
  }

  if (Object.keys(changes).length > 0) {
    const { error } = await supabase
      .from('cat_dex_entries')
      .update(changes)
      .eq('id', entry.id);

    if (error) throw error;
  }

  /*
   * Releasing the pin is a promotion, not a field.
   *
   * `best_photo_pinned: false` on its own would leave the tile frozen on whatever the player
   * had chosen, un-pinned but unchanged — which looks identical to the pin still being set.
   * Handing the tile back to the best-scoring shot is the whole meaning of releasing it, and
   * `promoteBestPhoto` is where that decision already lives.
   */
  if (patch.bestPhotoPinned === false) {
    await promoteBestPhoto(userId, entry.id, catId, { releasePin: true });
  }

  const fresh = await entryWithCat(userId, catId);
  const own = await ownEncountersFor(userId, [fresh.entry]);

  return {
    cat: serializeCat(
      fresh.entry,
      fresh.cat,
      own.get(catId) ?? EMPTY_ENCOUNTERS,
      userId
    ),
  };
}

/**
 * One entry of the caller's, with its cat.
 *
 * A cat the player has never photographed is a 404 rather than an empty entry, and so is a
 * cat that does not exist — deliberately the same answer, because distinguishing them would
 * let anyone probe which cat ids are real.
 */
async function entryWithCat(
  userId: string,
  catId: string
): Promise<{ entry: DexEntryRow; cat: CatRow }> {
  const { data, error } = await supabase
    .from('cat_dex_entries')
    .select(`*, cats ( ${CAT_COLUMNS} )`)
    .eq('user_id', userId)
    .eq('cat_id', catId)
    .maybeSingle();

  if (error) throw error;

  const cat = data ? embeddedCat((data as { cats?: unknown }).cats) : null;
  if (!data || !cat) throw new HttpError(404, 'That cat is not in your Cat Dex.');

  return { entry: data as unknown as DexEntryRow, cat };
}
