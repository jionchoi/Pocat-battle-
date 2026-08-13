/**
 * The map's rules: what is on it, for how long, and how precisely.
 *
 * Pure arithmetic with no database under it, so every rule here can be exercised without a
 * Supabase project — `scripts/check-map.ts` does exactly that. The coarsening below is the
 * most privacy-sensitive function in the codebase and it is the whole reason this file exists
 * separately from the service that calls it.
 */

/**
 * How long a capture stays on the map.
 *
 * Mirrors `MAP_CONFIG.sightingTtlHours` in the client's `constants/game.ts`, which uses it to
 * word the copy. **If you change one, change the other** — `scripts/check-map.ts` asserts they
 * agree, so the drift is caught rather than trusted to discipline.
 *
 * A pin is a claim about where a cat is *now*, and a three-day-old claim is a claim about
 * where a cat was. The map would otherwise silt up with every photograph ever taken and stop
 * being worth opening.
 */
export const SIGHTING_TTL_HOURS = 72;

/**
 * The most rows one viewport may return.
 *
 * A bounding box is client-supplied and a dense city block at low zoom can hold thousands of
 * captures. This is a ceiling on the response rather than paging, because a map does not page:
 * beyond a few hundred pins the screen is a solid mass of markers and the honest fix is to
 * zoom in, which the client already does.
 */
export const MAX_SIGHTINGS = 300;

/* -------------------------------------------------------------------------- */
/* The bounding box                                                           */
/* -------------------------------------------------------------------------- */

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * The widest box that will be answered, in degrees.
 *
 * Not a performance guard — `MAX_SIGHTINGS` is that. This stops the endpoint being used as a
 * bulk export: without it, one request with a world-sized box is a download of where every
 * player in the product has recently been standing, coarsened but still a dataset. Roughly a
 * large metropolitan area, which is far beyond any viewport the app actually asks for.
 */
export const MAX_BBOX_SPAN_DEG = 1.5;

/**
 * Parses the `bbox` query parameter, or says why it will not.
 *
 * The order is `minLng,minLat,maxLng,maxLat` — longitude first, matching GeoJSON and the
 * client's `bboxParam`. It reads backwards to anyone used to `lat,lng` pairs, which is
 * exactly why it is stated here and asserted in the checks.
 */
export function parseBbox(raw: string): Bbox | { error: string } {
  const parts = raw.split(',').map((piece) => Number(piece.trim()));

  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { error: 'That map area could not be read.' };
  }

  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];

  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
    return { error: 'That map area is outside the world.' };
  }

  if (Math.abs(minLng) > 180 || Math.abs(maxLng) > 180) {
    return { error: 'That map area is outside the world.' };
  }

  /*
   * A box that crosses the antimeridian arrives with `minLng > maxLng`, and it is refused
   * rather than silently returning nothing. Supporting it means splitting into two queries,
   * which is worth doing the day the product has players either side of the date line and
   * not before — but a wrong answer that looks like an empty neighbourhood is worse than a
   * clear refusal in the meantime.
   */
  if (minLat >= maxLat || minLng >= maxLng) {
    return { error: 'That map area could not be read.' };
  }

  if (maxLat - minLat > MAX_BBOX_SPAN_DEG || maxLng - minLng > MAX_BBOX_SPAN_DEG) {
    return { error: 'Zoom in a little to see sightings here.' };
  }

  return { minLat, maxLat, minLng, maxLng };
}

/** The oldest `captured_at` still eligible for a pin, as an ISO string. */
export function sightingCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - SIGHTING_TTL_HOURS * 3600_000).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Coarsening                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How far a published pin may be from where the photograph was actually taken.
 *
 * 150m puts a pin on the right block without putting it on a doorstep. Below about 50m a pin
 * identifies a building; above a few hundred it stops being useful for going to look.
 */
export const COARSEN_GRID_M = 150;

/**
 * The grid a player's **home** is stored on, and deliberately much coarser than a pin's.
 *
 * A kilometre, because this is not a pin and the two are protecting different things. A pin is
 * published so somebody can go and look for a cat, and 150m is the coarsest it can be while
 * still being worth walking to. A home is never published at all — it exists to suppress
 * captures near itself and to bucket a neighbourhood board — so precision buys nothing beyond
 * roughly the size of the area it names, and the cost of it being wrong is a person's address.
 *
 * A kilometre is also what `MapScreen` tells the player happens. That copy was written before
 * anything rounded, so this is the number the app already promised.
 */
export const HOME_GRID_M = 1_000;

/** Mean metres per degree of latitude. Good to a fraction of a percent anywhere on Earth. */
const M_PER_DEG_LAT = 111_320;

/**
 * Floor on the cosine used for the longitude step.
 *
 * Meridians converge to a point at the poles, so a fixed distance in metres becomes an
 * unbounded number of degrees — without this the step overflows above about 89.99° and the
 * snap returns NaN. Clamping caps the longitude cell at roughly 100km up there, which is
 * more coarsening rather than less, and nobody is photographing cats at the pole.
 */
const MIN_COS = 0.01;

/**
 * Moves a coordinate onto a fixed grid, for publishing to anyone but its owner.
 *
 * ## Why a grid and not random jitter
 *
 * This is the part that matters, and jitter is the intuitive choice that does not work.
 * Offsetting a point by a random 150m looks identical in a screenshot and leaks the true
 * position to anyone patient: each request draws a fresh sample around the same centre, so
 * averaging a few dozen of them converges on it. The noise is the thing that averages away.
 *
 * Snapping is deterministic. The same true coordinate always produces the same published
 * coordinate, so a thousand requests say exactly what one request says, and there is nothing
 * to average. What an observer learns is the cell — which is all they can ever learn.
 *
 * ## What it does not protect
 *
 * A cell is still a cell. Somebody who photographs the same cat from their own doorstep every
 * morning publishes a repeating pin near their home, and no amount of coarsening fixes that —
 * only the `shared_to_map` switch does, which is why it is one tap and why the privacy copy
 * describes it honestly. Suppressing captures near a player's home address is the real answer
 * and waits on `profiles` having one.
 */
export function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  return coarsenTo(lat, lng, COARSEN_GRID_M);
}

/**
 * The same snap, to a caller-chosen grid.
 *
 * Two things are coarsened in this product and they want different cells — a published pin at
 * 150m and a stored home at a kilometre. The *reasoning* about snapping versus jitter above
 * applies identically to both, so it is one implementation with the grid as an argument rather
 * than a second copy that could drift into being jitter by accident.
 */
export function coarsenTo(
  lat: number,
  lng: number,
  gridM: number
): { lat: number; lng: number } {
  const latStep = gridM / M_PER_DEG_LAT;

  // Computed from the true latitude, not the snapped one, so the cell a point lands in never
  // depends on which side of a boundary its own rounding put it.
  const cos = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), MIN_COS);
  const lngStep = gridM / (M_PER_DEG_LAT * cos);

  return {
    lat: snap(lat, latStep),
    lng: snap(lng, lngStep),
  };
}

/**
 * Snaps to the nearest grid node and trims float noise.
 *
 * Five decimal places is about a metre — two orders of magnitude finer than the grid, so it
 * cannot narrow the cell, and it keeps `0.1 + 0.2` artefacts out of a value that goes over
 * the wire and gets compared in tests.
 */
function snap(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(5));
}
