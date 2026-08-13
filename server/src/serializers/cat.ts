import { publicUrlFor } from '../lib/storage.js';

/**
 * A cat, as the Cat Dex draws it.
 *
 * The client's `Cat` is not a row. It is the *player's relationship* with an animal — their
 * nickname for it, their encounter count, their best shot — joined onto the shared record of
 * the animal itself. Two players looking at the same cat get two different `Cat` objects, and
 * that is the design rather than a denormalisation.
 */

export interface CatRow {
  id: string;
  discovered_by: string | null;
  default_nickname: string;
  first_seen_lat: number;
  first_seen_lng: number;
  /**
   * Where the animal was last seen *by anybody*, and therefore never emitted.
   *
   * Carried on the row because identity has to compare against it before publishing a move,
   * but it is somebody else's capture position as often as not. `serializeCat` sends the
   * player's own first sighting instead — see `OwnEncounters.firstSeenLocation`.
   */
  last_seen_lat: number;
  last_seen_lng: number;
  last_seen_at: string;
}

export interface DexEntryRow {
  id: string;
  user_id: string;
  cat_id: string;
  nickname: string | null;
  bio: string | null;
  best_photo_id: string | null;
  best_photo_score: number;
  best_tier: string;
  best_photo_pinned: boolean;
  encounter_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * What the player's own photographs of this cat say about it.
 *
 * Gathered by the caller because it takes a query the serializer has no business making, and
 * because every caller already has to run it for `photoCount`.
 */
export interface OwnEncounters {
  photoCount: number;
  /** Storage path of the entry's tile, when there is one. */
  bestPhotoPath: string | null;
  /**
   * Where *this player* first photographed this cat.
   *
   * Deliberately not `cats.first_seen_lat/lng`. Those are where the animal was first seen by
   * whoever discovered it, and for a cat the player did not discover that is a stranger's
   * exact position — the same leak the map serializer coarsens against, arriving through the
   * Dex instead. Null when the player has no photographs of it left.
   */
  firstSeenLocation: { lat: number; lng: number } | null;
}

export function serializeCat(
  entry: DexEntryRow,
  cat: CatRow,
  own: OwnEncounters,
  viewerId: string
) {
  return {
    id: cat.id,

    /*
     * Empty rather than null when the discoverer's account is gone. `discovered_by` is
     * ON DELETE SET NULL precisely so deleting an account does not delete a cat out of other
     * players' dexes, so this is a state that will really happen, and the client's type wants
     * a string. `discoveredByMe` below is the field anything actually branches on.
     */
    discoveredByUserId: cat.discovered_by ?? '',
    discoveredByMe: cat.discovered_by === viewerId,

    /*
     * What this player calls it, falling back to what it was called when it was discovered.
     * The same two layers `catNames.ts` resolves for a photo's `catNickname`, so a cat is
     * named the same way whichever screen reaches it.
     */
    nickname: entry.nickname ?? cat.default_nickname,
    bio: entry.bio ?? undefined,

    bestPhotoId: entry.best_photo_id ?? '',
    bestPhotoPinned: entry.best_photo_pinned,
    bestPhotoScore: entry.best_photo_score,
    bestTier: entry.best_tier as 'Common' | 'Rare' | 'Epic' | 'Legendary',
    bestPhotoUrl: own.bestPhotoPath ? publicUrlFor(own.bestPhotoPath) : '',

    encounterCount: entry.encounter_count,
    photoCount: own.photoCount,

    /*
     * Both of these are the player's own history, not the animal's.
     *
     * `firstSeenLocation` is where they first photographed it — see the note on
     * `OwnEncounters`. `lastSeenAt` is the entry's, not the cat's, for the same reason in the
     * other direction: `cats.last_seen_at` moves when anybody photographs it, so showing it
     * here would tell a player their cat was "seen today" on the strength of a stranger's
     * capture they cannot see.
     *
     * The zero pair is the no-photographs-left case, and it is drawn from `photoCount: 0`
     * rather than from the coordinates — the same reason the photo serializer sends zeroes
     * beside a null `scoredAt` instead of making the field optional.
     */
    firstSeenLocation: own.firstSeenLocation ?? { lat: 0, lng: 0 },
    lastSeenAt: entry.last_seen_at,
  };
}
