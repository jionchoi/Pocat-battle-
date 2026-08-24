import type { MapSighting } from '../api/endpoints';
import type { GeoPoint } from '../models';
import { distanceBetween } from '../utils/format';

/**
 * Grouping sightings that happened in the same place.
 *
 * A cat that sits in the same doorway every afternoon is photographed from the same three feet
 * of pavement over and over, so the map draws a dozen pins on top of each other. That is
 * unreadable — and worse, untappable, because the one on top is whichever the renderer
 * happened to put there and the others cannot be reached at all.
 *
 * ## Why grouping is nearly free here
 *
 * The server already snaps everybody else's pins onto a 150m grid before sending them, so two
 * captures on the same street usually arrive carrying the *same* coordinate. Those group at any
 * radius. The radius is doing real work only on the player's own pins, which are sent exact.
 *
 * ## Why a radius and not a grid
 *
 * A grid is what the server uses to coarsen, and it is right there because determinism is the
 * point — the same coordinate must always publish the same cell. Here the requirement is the
 * opposite: two photographs ten metres apart must land together, and a grid splits them
 * whenever they straddle a cell boundary, which is exactly the doorway case. So this walks the
 * list instead. `MAX_SIGHTINGS` caps the input at 300, so the quadratic pass is a few thousand
 * comparisons once per viewport fetch.
 */

export interface SightingCluster {
  /**
   * The representative's id.
   *
   * Stable across refetches as long as the same photograph stays newest, which is what keeps
   * React from tearing down and rebuilding every marker on the map each time the viewport
   * reloads — remounting a marker makes it flicker and drops its press state.
   */
  id: string;
  /**
   * Where the pin goes: the representative's own coordinate, never an average of the group.
   *
   * A centroid would be a coordinate that no capture actually reported, computed from points
   * the server deliberately rounded — arithmetic over coarsened values is the one way to get
   * back something finer than what was published, and there is no reason to invent it when one
   * of the real points is already correct to within the radius.
   */
  location: GeoPoint;
  /** Newest first, the order the server sent them. */
  sightings: MapSighting[];
  /** True when every capture in the group is verified — mixed groups read as unverified. */
  verified: boolean;
  /** True when any capture in the group is the player's own. */
  hasMine: boolean;
}

/**
 * Groups sightings within `radiusM` of each other.
 *
 * Greedy and order-dependent on purpose: the input is newest-first, so the newest unclaimed
 * photograph founds each group and pulls in everything near it. That makes the representative —
 * the pin's position, its id, and the first photo shown when it is opened — the most recent
 * sighting there, which is the one most likely to still be true.
 */
export function clusterSightings(
  sightings: readonly MapSighting[],
  radiusM: number
): SightingCluster[] {
  const clusters: SightingCluster[] = [];
  const claimed = new Array<boolean>(sightings.length).fill(false);

  for (let i = 0; i < sightings.length; i += 1) {
    if (claimed[i]) continue;

    const head = sightings[i]!;
    claimed[i] = true;

    const members: MapSighting[] = [head];

    /*
     * Measured against the founder, not against the group as it grows.
     *
     * Chaining — absorbing anything near any member — would let a row of photographs down a
     * long street link into one pin covering far more than the radius, with the pin sitting at
     * one end of it. Every member here is within `radiusM` of the point the pin is drawn at,
     * which is the property that makes the pin's position honest.
     */
    for (let j = i + 1; j < sightings.length; j += 1) {
      if (claimed[j]) continue;

      const other = sightings[j]!;
      if (distanceBetween(head.location, other.location) > radiusM) continue;

      claimed[j] = true;
      members.push(other);
    }

    clusters.push({
      id: head.id,
      location: head.location,
      sightings: members,
      verified: members.every((s) => s.verified),
      hasMine: members.some((s) => s.isMine),
    });
  }

  return clusters;
}
