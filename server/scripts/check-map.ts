/**
 * The map's rules, checked without a database.
 *
 *     cd server && npx tsx scripts/check-map.ts
 *
 * The coarsening block is the reason this file exists. It is the one function in the codebase
 * whose bugs are privacy incidents rather than wrong pixels, and every property that makes it
 * safe — determinism, bounded error, no dependence on the reader — is checkable as pure
 * arithmetic.
 */

import { readFileSync } from 'node:fs';

import {
  COARSEN_GRID_M,
  HOME_GRID_M,
  MAX_BBOX_SPAN_DEG,
  SIGHTING_TTL_HOURS,
  coarsen,
  coarsenTo,
  parseBbox,
  sightingCutoff,
} from '../src/game/map.js';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

function ok(label: string, condition: boolean): void {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
}

/** Metres between two points, near enough at these distances. */
function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

console.log('\n-- reading a bounding box --\n');

check('lng first, then lat — the GeoJSON order the client sends', parseBbox('-0.13,51.50,-0.11,51.52'), {
  minLat: 51.5,
  maxLat: 51.52,
  minLng: -0.13,
  maxLng: -0.11,
});

ok('three numbers is not a box', 'error' in parseBbox('-0.13,51.50,-0.11'));
ok('words are not a box', 'error' in parseBbox('a,b,c,d'));
ok('empty is not a box', 'error' in parseBbox(''));
ok('a latitude off the world is refused', 'error' in parseBbox('-0.13,91,-0.11,92'));
ok('a longitude off the world is refused', 'error' in parseBbox('-181,51.5,-179,51.6'));
ok('a zero-area box is refused', 'error' in parseBbox('-0.13,51.5,-0.13,51.5'));
ok('an inverted box is refused rather than silently empty', 'error' in parseBbox('-0.11,51.52,-0.13,51.50'));

/*
 * The bulk-export guard. Without it one request is a download of where every player in the
 * product has recently been standing — coarsened, but still a dataset.
 */
ok(
  'a world-sized box is refused',
  'error' in parseBbox('-180,-85,180,85')
);
ok(
  `a box wider than ${MAX_BBOX_SPAN_DEG}° is refused`,
  'error' in parseBbox(`0,51.5,${MAX_BBOX_SPAN_DEG + 0.1},51.6`)
);
ok(
  'a box just inside the span is answered',
  !('error' in parseBbox(`0,51.5,${MAX_BBOX_SPAN_DEG - 0.1},51.6`))
);
ok(
  'the too-big message tells the player what to do',
  (parseBbox('-180,-85,180,85') as { error: string }).error.includes('Zoom in')
);

console.log('\n-- the time to live --\n');

const now = new Date('2026-08-12T12:00:00.000Z');
check(
  `${SIGHTING_TTL_HOURS}h before now`,
  sightingCutoff(now),
  '2026-08-09T12:00:00.000Z'
);

console.log('\n-- coarsening --\n');

const home = { lat: 51.50735, lng: -0.12776 };
const pin = coarsen(home.lat, home.lng);

ok('a coarsened pin is not the true point', pin.lat !== home.lat || pin.lng !== home.lng);

/*
 * The property that makes grid-snapping safe where random jitter is not. Jitter draws a fresh
 * sample per request, so averaging enough of them recovers the true point; snapping returns
 * the identical answer forever, so a thousand requests say what one request says.
 */
ok(
  'the same point always coarsens to the same pin',
  JSON.stringify(coarsen(home.lat, home.lng)) === JSON.stringify(coarsen(home.lat, home.lng))
);

/*
 * And the corollary: sampling cannot narrow it. Every true point inside one cell has to
 * publish the *same* pin, or the pin would track the point within the cell.
 */
const nudged = coarsen(home.lat + 0.0001, home.lng + 0.0001);
ok(
  'a small move inside the cell does not move the pin',
  JSON.stringify(nudged) === JSON.stringify(pin)
);

ok(`error stays under the ${COARSEN_GRID_M}m grid`, metresBetween(home, pin) < COARSEN_GRID_M);

/* A grid that only ever returned one value would pass every test above and be useless. */
const far = coarsen(51.52, -0.1);
ok('somewhere genuinely else lands on a different pin', far.lat !== pin.lat || far.lng !== pin.lng);

/*
 * Meridians converge, so a fixed distance in metres is a widening number of degrees as you go
 * north. A grid using one longitude step everywhere would coarsen far too little in Reykjavik.
 *
 * Measured rather than asserted about: walk east until the published pin changes, and the
 * distance you walked is the cell width. Reykjavik is at 64°N where cos is about 0.44, so its
 * cells should be roughly twice as wide in degrees as the equator's.
 */
function lngCellWidthAt(lat: number): number {
  const first = coarsen(lat, 0).lng;

  for (let lng = 0; lng < 1; lng += 0.000005) {
    const here = coarsen(lat, lng).lng;
    if (here !== first) return Math.abs(here - first);
  }

  return Number.NaN;
}

const equatorCell = lngCellWidthAt(0);
const arcticCell = lngCellWidthAt(64.1466);

ok(
  `the longitude cell widens with latitude (${equatorCell.toFixed(5)}° vs ${arcticCell.toFixed(5)}°)`,
  arcticCell > equatorCell * 1.8
);

/*
 * And in metres it stays the same size, which is the point of varying the degrees at all.
 * A cell that were a fixed number of degrees would be a 65m cell in Reykjavik.
 */
const arcticCellM = arcticCell * 111_320 * Math.cos((64.1466 * Math.PI) / 180);
ok(
  `the cell stays about ${COARSEN_GRID_M}m wide in metres (${arcticCellM.toFixed(0)}m at 64°N)`,
  Math.abs(arcticCellM - COARSEN_GRID_M) < 5
);

const equator = coarsen(0.0004, 0.004);
ok('the equator is handled without dividing by zero', Number.isFinite(equator.lat) && Number.isFinite(equator.lng));

/* Where cos(lat) collapses. Without the floor this returns NaN and the pin vanishes. */
const pole = coarsen(89.9999, 100);
ok('near the pole stays finite', Number.isFinite(pole.lat) && Number.isFinite(pole.lng));

/* The southern hemisphere and the western one are not special cases, and must not be. */
const south = { lat: -33.8688, lng: 151.2093 };
ok('negative latitudes coarsen too', metresBetween(south, coarsen(south.lat, south.lng)) < COARSEN_GRID_M);

console.log('\n-- a home is coarsened harder than a pin --\n');

/*
 * `profiles.home_lat/lng` is the most sensitive value in the schema, and until 2026-08-13 the
 * raw GPS fix went straight into it — while `MapScreen` told the player "the server rounds it
 * to a ~1km cell". These are that sentence, made true.
 */
const trueHome = { lat: 51.5074, lng: -0.1278 };
const storedHome = coarsenTo(trueHome.lat, trueHome.lng, HOME_GRID_M);

ok('a home is coarser than a published pin', HOME_GRID_M > COARSEN_GRID_M);
ok('the stored home is not the true point', storedHome.lat !== trueHome.lat || storedHome.lng !== trueHome.lng);
ok(
  `the stored home lands within the ${HOME_GRID_M}m grid`,
  metresBetween(trueHome, storedHome) < HOME_GRID_M
);
ok(
  'it is deterministic, so repeated writes cannot be averaged',
  JSON.stringify(coarsenTo(trueHome.lat, trueHome.lng, HOME_GRID_M)) ===
    JSON.stringify(coarsenTo(trueHome.lat, trueHome.lng, HOME_GRID_M))
);

/*
 * Two points a few hundred metres apart are different pins — that is what a 150m grid is for —
 * and must land on essentially the same home, or "where you live" would move every time
 * somebody crossed a street.
 *
 * ## Why this asserts proximity rather than equality
 *
 * It is *not* one stable global grid, and that is worth knowing before anybody builds the
 * neighbourhood board on it. The longitude step is `gridM / (m_per_deg * cos(lat))` computed
 * from each point's own true latitude, so the longitude cell boundaries shift continuously as
 * latitude changes: these two points snap to the same latitude cell and to longitudes differing
 * in the fifth decimal, about a metre apart.
 *
 * Harmless for the two things the value is actually for — suppressing captures near home is a
 * distance test, and the privacy property is determinism per point, which holds exactly. But
 * **grouping players into a shared bucket by comparing these pairs for equality would not
 * work**, and that is precisely what a neighbourhood leaderboard would reach for. §6 already
 * says that board needs a way to name an area; this is a second reason it cannot just be
 * `group by home_lat, home_lng`.
 */
const downTheRoad = { lat: trueHome.lat + 0.0018, lng: trueHome.lng };
ok(
  'two points ~200m apart are different pins',
  JSON.stringify(coarsen(trueHome.lat, trueHome.lng)) !==
    JSON.stringify(coarsen(downTheRoad.lat, downTheRoad.lng))
);
check(
  'and land in the same home latitude cell',
  coarsenTo(downTheRoad.lat, downTheRoad.lng, HOME_GRID_M).lat,
  storedHome.lat
);
ok(
  'with longitudes within a metre of each other, not identical — see above',
  metresBetween(storedHome, coarsenTo(downTheRoad.lat, downTheRoad.lng, HOME_GRID_M)) < 5
);

ok(
  'coarsen() is still exactly the pin grid',
  JSON.stringify(coarsen(trueHome.lat, trueHome.lng)) ===
    JSON.stringify(coarsenTo(trueHome.lat, trueHome.lng, COARSEN_GRID_M))
);

console.log('\n-- the TTL is mirrored, so the two copies must agree --\n');

/*
 * `constants/game.ts` is a React Native module and will not import under plain tsx, so the
 * literal is read as text. The thing being checked is the number, not the module.
 */
const clientSource = readFileSync(
  new URL('../../src/constants/game.ts', import.meta.url),
  'utf8'
);
const match = clientSource.match(/sightingTtlHours:\s*(\d+)/);

if (!match) {
  failures += 1;
  console.log('FAIL  could not find sightingTtlHours in the client — has it moved or been renamed?');
} else {
  check('client and server agree on the TTL', Number(match[1]), SIGHTING_TTL_HOURS);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
