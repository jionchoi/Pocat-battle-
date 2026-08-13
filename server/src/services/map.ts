import { supabase } from '../lib/supabase.js';
import { MAX_SIGHTINGS, sightingCutoff, type Bbox } from '../game/map.js';
import { serializeSighting, type ReporterRow } from '../serializers/sighting.js';
import type { PhotoRow } from '../serializers/photo.js';

/**
 * The map.
 *
 * Pins are a **live read of `photos`**, not rows written when a capture happened. That was
 * decided when `shared_to_map` was added and the note in `services/photos.ts` states it: a
 * photo un-shared from the map drops out of this query on the next request, with nothing to
 * undo and nothing to keep in step. A separate `sightings` table would have to be updated
 * from three places — capture, the toggle, and delete — and would be wrong whenever one of
 * them was missed.
 *
 * ## What this endpoint is not
 *
 * It is not a feed and it is not paged. A viewport either fits on the screen or the player
 * zooms in, so the answer to too many pins is `MAX_SIGHTINGS` and a smaller box, not a cursor.
 */

/**
 * Every capture worth drawing in a box.
 *
 * Four filters, and each is load-bearing:
 *
 *   `shared_to_map` — the owner's switch. Off means no pin for anyone, and the coordinates
 *                     stay on the row for cat matching, which is the whole point of the flag.
 *   the cutoff      — a pin is a claim about where a cat is now.
 *   the box         — validated by the caller, capped in span so this cannot be a bulk export.
 *   the limit       — one more than asked for is not needed; there is no next page.
 *
 * Newest first, so when a dense block is truncated what survives is the most recent — the
 * pins most likely to still be true.
 */
export async function sightingsIn(viewerId: string, bbox: Bbox) {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('shared_to_map', true)
    .gte('captured_at', sightingCutoff())
    .gte('captured_lat', bbox.minLat)
    .lte('captured_lat', bbox.maxLat)
    .gte('captured_lng', bbox.minLng)
    .lte('captured_lng', bbox.maxLng)
    .order('captured_at', { ascending: false })
    .limit(MAX_SIGHTINGS);

  if (error) throw error;

  const rows = (data ?? []) as PhotoRow[];
  const reporters = await reportersFor(rows.map((row) => row.owner_id));

  return {
    sightings: rows.map((row) =>
      serializeSighting(row, reporters.get(row.owner_id) ?? null, viewerId)
    ),
  };
}

/**
 * Who took each of these, in one query.
 *
 * Not an embed on the select above. PostgREST can join `photos` to `profiles`, but a viewport
 * is very often many photographs by the same handful of people — a street somebody walks every
 * day is dozens of rows and one reporter — and an embed carries a full copy of that profile on
 * every one of them. One `in` over the distinct owners is a fraction of the payload and a
 * fraction of the work.
 *
 * A missing id is a real state rather than an error: `discovered_by` and its neighbours are
 * `on delete set null`, so an account can be gone while its captures are not. The serializer
 * draws those as an unattributed pin.
 */
async function reportersFor(ownerIds: readonly string[]): Promise<Map<string, ReporterRow>> {
  const unique = [...new Set(ownerIds)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', unique);

  if (error) throw error;

  const map = new Map<string, ReporterRow>();
  for (const row of (data ?? []) as ReporterRow[]) map.set(row.id, row);

  return map;
}
