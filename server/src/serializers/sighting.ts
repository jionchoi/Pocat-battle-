import { publicUrlFor } from '../lib/storage.js';
import { coarsen } from '../game/map.js';
import type { PhotoRow } from './photo.js';

/**
 * A capture, as a pin on somebody else's map.
 *
 * The narrowest serializer in the codebase, and the only one whose output depends on *who is
 * reading*. Everything else here answers the owner of the row; this one mostly does not, and
 * the difference decides how precise a coordinate it is allowed to emit.
 *
 * `serializePhoto` and this file must never be swapped for one another. That one sends
 * `capturedLocation` as the exact pair because every route using it answers the photo's own
 * owner — the note there says so. This one is the other audience.
 */

export interface ReporterRow {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

export function serializeSighting(
  row: PhotoRow,
  reporter: ReporterRow | null,
  viewerId: string
) {
  const isMine = row.owner_id === viewerId;

  /*
   * Exact for the owner, snapped to a grid for everyone else.
   *
   * The branch is here rather than in the service so it cannot be forgotten by a future
   * caller: any route that wants to publish a location has to come through this function,
   * and this function cannot emit a precise coordinate to a stranger.
   */
  const location = isMine
    ? { lat: row.captured_lat, lng: row.captured_lng }
    : coarsen(row.captured_lat, row.captured_lng);

  const scored = row.scored_at !== null;

  return {
    id: row.id,
    reportedByUserId: row.owner_id,
    location,
    photoUrl: publicUrlFor(row.storage_path),

    /*
     * A photograph is the verification.
     *
     * Every pin the map serves today is backed by a capture, so this is constant — and it is
     * constant at `true` rather than being dropped, because the client draws "Verified
     * sighting" against "Single report" and the second of those is what a bare
     * `POST /map/sightings` would produce. That endpoint has no caller and no table behind it;
     * the day it gets one, this is the field that tells the two apart.
     */
    verified: true,

    // The capture's own time, not the row's. A photo identified or edited later is still a
    // sighting from when the shutter fired, and the TTL is measured against the same field.
    createdAt: row.captured_at,

    /*
     * Null until the photograph has been judged, rather than the zeroes the album serializer
     * fills in. A map pin has no `scoredAt` beside it to qualify a number, so a zero here
     * would read as a real verdict of nought — the client's type makes both nullable for
     * exactly this reason and each degrades on its own.
     */
    score: scored ? (row.score_total ?? 0) : null,
    tier: scored
      ? ((row.tier ?? 'Common') as 'Common' | 'Rare' | 'Epic' | 'Legendary')
      : null,

    /*
     * Null when the account is gone, and when onboarding never finished.
     *
     * `username` is nullable until a player picks one, and a pin captioned "by null" is worse
     * than one captioned "reported" — which is what the client draws when this is absent.
     */
    reporter:
      reporter && reporter.username
        ? { username: reporter.username, avatarUrl: reporter.avatar_url ?? '' }
        : null,

    isMine,
  };
}
