import { supabase } from '../lib/supabase.js';
import { publicUrlFor } from '../lib/storage.js';
import {
  MAX_CANDIDATES,
  POOL_LIMIT,
  SEARCH_RADIUS_M,
  SHORTLIST_SCOPE,
  agreementBetween,
  confidenceOf,
  distanceM,
  idfOver,
  matchedTraits,
  proximityOf,
  reasonsFor,
  tokensOf,
} from '../game/matching.js';
import type { PhotoRow } from '../serializers/photo.js';

/**
 * Which cat is this a photograph of?
 *
 * Fetching and assembly only. The rules — how far to look, what a trait is worth, how the two
 * combine into an ordering — are in `game/matching.ts`, with no database underneath them so
 * they can be exercised on their own.
 *
 * Costs nothing. Every input is already on rows we hold, so no model call happens here, which
 * is why re-identifying as often as somebody likes is free.
 */

/**
 * Mirrors `CatCandidate` in the client's `src/models/index.ts`, which is the contract.
 *
 * Notably not a `Cat`: a candidate may be an animal this player has never photographed, and a
 * `Cat` carries their nickname, their encounter count and their best shot. The three
 * owner-relative fields below are held at null and zero unless `inYourDex`, enforced here
 * rather than trusted to the caller — see `enrich`.
 */
export interface CatCandidate {
  id: string;
  nickname: string;
  confidence: number;
  reasons: string[];
  inYourDex: boolean;
  thumbnailUrl: string | null;
  encounterCount: number;
  lastSeenAt: string;
}

interface CatRow {
  id: string;
  default_nickname: string;
  coat_pattern: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  eye_color: string | null;
  markings: string[];
  last_seen_lat: number;
  last_seen_lng: number;
  last_seen_at: string;
}

interface DexRow {
  cat_id: string;
  nickname: string | null;
  best_photo_id: string | null;
  encounter_count: number;
}

/* -------------------------------------------------------------------------- */
/* The shortlist                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Cats this photograph might be of, best first.
 *
 * Returns an empty list rather than throwing when there is nobody nearby. That is a real and
 * common answer — the first cat photographed in a neighbourhood has no neighbours — and it is
 * what raises the "add a new cat" prompt rather than an error.
 */
export async function candidatesFor(
  userId: string,
  photo: Pick<PhotoRow, 'cat_id' | 'captured_lat' | 'captured_lng' | 'traits'>
): Promise<CatCandidate[]> {
  /*
   * The player's own dex, fetched first because it is needed twice: to restrict the pool
   * under 'dex-only', and to fill in the owner-relative fields on whatever survives ranking.
   * One query for both rather than one per use.
   */
  const dex = await dexEntriesOf(userId);

  if (SHORTLIST_SCOPE === 'dex-only' && dex.size === 0) return [];

  const nearby = await nearbyCats(
    photo.captured_lat,
    photo.captured_lng,
    SHORTLIST_SCOPE === 'dex-only' ? [...dex.keys()] : null
  );

  /*
   * The cat this photo is already attributed to is not an option.
   *
   * Every caller is asking "which cat is this", and the answer already on the row is the one
   * being reconsidered. Leaving it in would offer "is this Mochi?" about a photograph that
   * already says Mochi.
   */
  const pool = nearby.filter((cat) => cat.id !== photo.cat_id);

  if (pool.length === 0) return [];

  // Tokenised once per cat and reused for the weighting, the agreement and the phrases —
  // three passes over the same pool otherwise.
  const described = pool.map((cat) => ({ cat, tokens: tokensOf(traitsOfCat(cat)) }));
  const idf = idfOver(described.map(({ tokens }) => tokens));
  const wanted = tokensOf(photo.traits);

  const scored = described
    .map(({ cat, tokens }) => {
      const metres = distanceM(
        photo.captured_lat,
        photo.captured_lng,
        cat.last_seen_lat,
        cat.last_seen_lng
      );

      const agreement = agreementBetween(wanted, tokens, idf, described.length);

      return {
        cat,
        metres,
        confidence: confidenceOf(proximityOf(metres), agreement),
        matched: matchedTraits(wanted, tokens, idf, described.length),
      };
    })
    /*
     * Sorted, not filtered. There is no confidence floor on purpose: a low score means the
     * model described the animal poorly or somebody photographed it from across the street,
     * and hiding the right cat for either reason produces the duplicate Dex entry this whole
     * design is arranged around avoiding. The player is the filter.
     */
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CANDIDATES);

  return enrich(scored, dex);
}

/** The cat's stored description, in the shape the photo's own traits arrive in. */
function traitsOfCat(cat: CatRow) {
  return {
    coatPattern: cat.coat_pattern,
    primaryColor: cat.primary_color,
    secondaryColor: cat.secondary_color,
    eyeColor: cat.eye_color,
    markings: cat.markings,
  };
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

async function dexEntriesOf(userId: string): Promise<Map<string, DexRow>> {
  const { data, error } = await supabase
    .from('cat_dex_entries')
    .select('cat_id, nickname, best_photo_id, encounter_count')
    .eq('user_id', userId);

  if (error) throw error;

  return new Map((data ?? []).map((row) => [row.cat_id as string, row as DexRow]));
}

/**
 * Cats last seen inside a box around the capture.
 *
 * A box rather than a circle, because a box is two btree range scans on the index
 * `cats_last_seen_idx` already provides and a circle is PostGIS. The corners reach about 1.4×
 * the radius, so a few cats slightly outside it get ranked and then lose on proximity — a
 * cheaper mistake than adding an extension for a shortlist of five.
 *
 * Longitude is scaled by cos(lat) because a degree of longitude shrinks toward the poles.
 * Without it the box is the right height and the wrong width everywhere but the equator.
 */
async function nearbyCats(
  lat: number,
  lng: number,
  restrictTo: string[] | null
): Promise<CatRow[]> {
  const dLat = SEARCH_RADIUS_M / 110_574;

  /*
   * cos(lat) collapses to zero at the poles and would turn the longitude span into infinity.
   * Clamped rather than special-cased: at 89° a degree of longitude is still under 2km, so
   * this bound is only ever reached somewhere with no cats and no players.
   */
  const dLng = SEARCH_RADIUS_M / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));

  let query = supabase
    .from('cats')
    .select(
      'id, default_nickname, coat_pattern, primary_color, secondary_color, eye_color, markings, last_seen_lat, last_seen_lng, last_seen_at'
    )
    .gte('last_seen_lat', lat - dLat)
    .lte('last_seen_lat', lat + dLat)
    /*
     * A box spanning the antimeridian is expressed here as one spanning nothing, so a capture
     * within 300m of ±180° shortlists nobody and prompts a new cat. The fix is two queries
     * and a union; the affected strip is open ocean, so this is recorded rather than built.
     */
    .gte('last_seen_lng', lng - dLng)
    .lte('last_seen_lng', lng + dLng)
    .order('last_seen_at', { ascending: false })
    .limit(POOL_LIMIT);

  if (restrictTo) query = query.in('id', restrictTo);

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as CatRow[];
}

/* -------------------------------------------------------------------------- */
/* Filling in what the player owns                                            */
/* -------------------------------------------------------------------------- */

/**
 * Adds the player's own relationship with each cat, and withholds it where there is none.
 *
 * The nickname falls back the way `catNames.ts` does — what this player calls it, then what it
 * was called when it was discovered — so a cat is named consistently whether it reaches a
 * screen through a photo or through this list.
 *
 * The thumbnail is the part to be careful with. A Dex tile is a photograph, photographs belong
 * to whoever took them, and a candidate the player has never met has none of theirs to show.
 * That is enforced structurally: the only ids looked up are ones read off this player's own
 * dex rows, so there is no path where a stranger's photograph is fetched and then filtered out
 * afterwards.
 */
async function enrich(
  scored: readonly { cat: CatRow; metres: number; confidence: number; matched: string[] }[],
  dex: Map<string, DexRow>
): Promise<CatCandidate[]> {
  const photoIds = scored
    .map(({ cat }) => dex.get(cat.id)?.best_photo_id)
    .filter((id): id is string => Boolean(id));

  const thumbnails = await storagePathsFor(photoIds);

  return scored.map(({ cat, metres, confidence, matched }) => {
    const entry = dex.get(cat.id);
    const path = entry?.best_photo_id ? thumbnails.get(entry.best_photo_id) : undefined;

    return {
      id: cat.id,
      nickname: entry?.nickname ?? cat.default_nickname,
      confidence,
      reasons: reasonsFor(metres, matched),
      inYourDex: entry !== undefined,
      thumbnailUrl: path ? publicUrlFor(path) : null,
      encounterCount: entry?.encounter_count ?? 0,
      lastSeenAt: cat.last_seen_at,
    };
  });
}

async function storagePathsFor(photoIds: readonly string[]): Promise<Map<string, string>> {
  if (photoIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('photos')
    .select('id, storage_path')
    .in('id', [...photoIds]);

  if (error) throw error;

  return new Map((data ?? []).map((row) => [row.id as string, row.storage_path as string]));
}
