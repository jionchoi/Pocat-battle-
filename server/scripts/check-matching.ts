/**
 * Cat matching, checked without a database.
 *
 *     cd server && npx tsx scripts/check-matching.ts
 *
 * These checks existed once and lived nowhere — run by hand during the session that wrote
 * `game/matching.ts`, then lost. This is them landed, plus the `identify` body schema, which
 * had eight cases of its own in the same state.
 *
 * The ranking is the part of the product most likely to be quietly wrong. It produces an
 * ordering rather than an answer, so a bug does not throw and does not look like anything —
 * it just puts the wrong cat first, and the player confirms it, and two animals become one Dex
 * entry with nothing left to separate them.
 */

import {
  MAX_CANDIDATES,
  NEARBY_M,
  POOL_LIMIT,
  PROXIMITY_WEIGHT,
  SEARCH_RADIUS_M,
  SHORTLIST_SCOPE,
  TRAIT_WEIGHT,
  agreementBetween,
  confidenceOf,
  distanceM,
  idfOver,
  matchedTraits,
  proximityOf,
  reasonsFor,
  tokensOf,
  weightOf,
} from '../src/game/matching.js';
import { identifySchema } from '../src/controllers/photos.js';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  if (!good) failures += 1;
  console.log(
    `${good ? 'PASS' : 'FAIL'}  ${label}` +
      (good ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

function ok(label: string, condition: boolean): void {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
}

console.log('\n-- distance --\n');

check('a point is zero from itself', Math.round(distanceM(51.5074, -0.1278, 51.5074, -0.1278)), 0);
ok(
  'about 111m per thousandth of a degree of latitude',
  Math.abs(distanceM(51.5, -0.12, 51.501, -0.12) - 111) < 2
);
/*
 * Meridians converge, so the same longitude difference is a shorter distance the further north
 * you go. A matcher that ignored this would search an ellipse and call it a circle.
 */
ok(
  'longitude shrinks with latitude',
  distanceM(60, 0, 60, 0.01) < distanceM(0, 0, 0, 0.01)
);
ok('symmetric', Math.abs(distanceM(51.5, -0.12, 51.51, -0.13) - distanceM(51.51, -0.13, 51.5, -0.12)) < 0.001);

console.log('\n-- proximity --\n');

check('at the capture, 1', proximityOf(0), 1);
check('at the edge of the radius, 0', proximityOf(SEARCH_RADIUS_M), 0);
check('past the radius, still 0 and never negative', proximityOf(SEARCH_RADIUS_M * 3), 0);
ok('halfway is about half', Math.abs(proximityOf(SEARCH_RADIUS_M / 2) - 0.5) < 0.001);

console.log('\n-- traits become comparable tokens --\n');

check(
  'a described cat',
  [...tokensOf({ coatPattern: 'Tabby', primaryColor: 'Orange', eyeColor: 'green', markings: ['notched left ear'] })].sort(),
  ['coat:tabby', 'color:orange', 'eye:green', 'mark:notched left ear']
);
check('an undescribed photo has no tokens', [...tokensOf({})], []);
check('null traits are not an error', [...tokensOf(null)], []);
check('empty strings are not traits', [...tokensOf({ coatPattern: '   ', primaryColor: '' })], []);

/*
 * The colour-slot case, and the reason both colours share a prefix. A model shown the same
 * tuxedo twice calls it black-and-white one day and white-and-black the next; comparing by slot
 * would score that pair as a mismatch on *both* fields, turning the most recognisable thing
 * about the animal into evidence against itself.
 */
const tuxedoA = tokensOf({ primaryColor: 'black', secondaryColor: 'white' });
const tuxedoB = tokensOf({ primaryColor: 'white', secondaryColor: 'black' });
check('the same cat described the other way round is the same set', [...tuxedoA].sort(), [...tuxedoB].sort());

console.log('\n-- rarity is measured against the neighbourhood --\n');

/**
 * A street of tabbies with exactly one notched ear — what streets are actually like, because
 * cats are related to their neighbours. A maintained list of "common" words could never know
 * that; idf works it out from the pool it is given.
 */
function street(size: number) {
  return [
    ...Array.from({ length: size - 1 }, () =>
      tokensOf({ coatPattern: 'tabby', primaryColor: 'brown' })
    ),
    tokensOf({ coatPattern: 'tabby', primaryColor: 'brown', markings: ['notched left ear'] }),
  ];
}

const pool = street(40);
const idf = idfOver(pool);

ok(
  'a marking one cat has outweighs a coat they all share',
  weightOf('mark:notched left ear', idf, pool.length) > weightOf('coat:tabby', idf, pool.length)
);
ok(
  'a trait the pool has never seen weighs most of all',
  weightOf('mark:three legs', idf, pool.length) >= weightOf('mark:notched left ear', idf, pool.length)
);

console.log('\n-- agreement --\n');

const wanted = tokensOf({ coatPattern: 'tabby', primaryColor: 'brown', markings: ['notched left ear'] });

const perfect = agreementBetween(wanted, wanted, idf, pool.length);
check('a cat matching everything scores 1', perfect, 1);

const commonOnly = agreementBetween(wanted, tokensOf({ coatPattern: 'tabby', primaryColor: 'brown' }), idf, pool.length)!;
const rareOnly = agreementBetween(wanted, tokensOf({ markings: ['notched left ear'] }), idf, pool.length)!;

/*
 * The whole reason the trait system exists. A notch in an ear has to outrank the two traits
 * every cat on the street shares, or the shortlist is ordered by how ordinary a cat is.
 */
ok(`one decisive trait beats two ubiquitous ones (${rareOnly.toFixed(2)} vs ${commonOnly.toFixed(2)})`, rareOnly > commonOnly);

/*
 * ── A cold-start property, pinned rather than hidden ────────────────────────
 *
 * idf needs a pool to measure against, and on a very small one it barely discriminates: with
 * four cats, `log(1 + 4/2)` over `log(1 + 4/5)` is under 2x, so two common matches still beat
 * one rare one. The crossover is between four and eight.
 *
 * That means the first few cats recorded in a new neighbourhood rank worse than they will once
 * there are a dozen — the matcher gets better as the area fills in, and it is at its worst
 * exactly when a player is meeting their first cats. Nothing is wrong with the arithmetic; it
 * is the honest behaviour of measuring rarity against evidence you do not have yet.
 *
 * This is asserted so that changing it is a deliberate act. BACKEND.md §6 says the weights were
 * tuned against "a synthetic four-cat pool", and this is what that pool could not show.
 */
const tiny = street(4);
const tinyIdf = idfOver(tiny);
const tinyCommon = agreementBetween(wanted, tokensOf({ coatPattern: 'tabby', primaryColor: 'brown' }), tinyIdf, tiny.length)!;
const tinyRare = agreementBetween(wanted, tokensOf({ markings: ['notched left ear'] }), tinyIdf, tiny.length)!;

ok(
  `known: on a four-cat pool the rare trait does NOT yet win (${tinyRare.toFixed(2)} vs ${tinyCommon.toFixed(2)})`,
  tinyRare < tinyCommon
);
ok(
  'and it does by eight',
  (() => {
    const p = street(8);
    const i = idfOver(p);
    return agreementBetween(wanted, tokensOf({ markings: ['notched left ear'] }), i, p.length)! >
      agreementBetween(wanted, tokensOf({ coatPattern: 'tabby', primaryColor: 'brown' }), i, p.length)!;
  })()
);

check('nothing in common scores 0', agreementBetween(wanted, tokensOf({ coatPattern: 'calico' }), idf, pool.length), 0);

/*
 * Null, not zero, and the difference is load-bearing: zero means "described, and this is not
 * it", null means "never described" and the caller ranks on location alone.
 */
check('an undescribed photo agrees with nothing and nothing', agreementBetween(tokensOf({}), wanted, idf, pool.length), null);

/*
 * The denominator is what the photo claims, not what the cat has — or a cat with fifteen
 * recorded markings would out-rank a better match by having more chances to hit.
 */
const busy = tokensOf({ coatPattern: 'tabby', primaryColor: 'brown', markings: ['a', 'b', 'c', 'd', 'e'] });
check('extra traits on the candidate do not dilute the score', agreementBetween(wanted, busy, idf, pool.length), commonOnly);

check(
  'matched traits come back heaviest first, without their prefixes',
  matchedTraits(wanted, wanted, idf, pool.length)[0],
  'notched left ear'
);

console.log('\n-- confidence --\n');

check('right here and a perfect description', confidenceOf(1, 1), 1);
check('nowhere near and nothing alike', confidenceOf(0, 0), 0);

/*
 * The honest ceiling. Identifying deliberately does not wait for a score, so an unscored
 * photograph — the ordinary state of anything taken past the day's allowance — has no traits
 * to rank on, and "a cat was near where you stood" should present as the weak evidence it is.
 */
check('an undescribed photo cannot beat the proximity weight', confidenceOf(1, null), PROXIMITY_WEIGHT);
ok('and less so further away', confidenceOf(0.5, null) < PROXIMITY_WEIGHT);

ok(
  'a far cat that matches the description beats a near one that does not',
  confidenceOf(0.1, 1) > confidenceOf(1, 0)
);
check('two decimals, no more', confidenceOf(0.3333, 0.6666), Math.round((PROXIMITY_WEIGHT * 0.3333 + TRAIT_WEIGHT * 0.6666) * 100) / 100);

console.log('\n-- reasons --\n');

check('close by', reasonsFor(10, []), ['seen nearby']);
check('further out', reasonsFor(NEARBY_M + 1, []), ['seen a few streets away']);
check('at most two traits ride along', reasonsFor(10, ['a', 'b', 'c', 'd']), ['seen nearby', 'a', 'b']);

/*
 * The rule that keeps a shortlist from becoming a way to ask where somebody else's cat lives.
 * `cats.last_seen_*` is bumped by whoever photographed the animal last, so a distance computed
 * from it is a distance to a stranger's capture — "42m away" would render that as a helpful
 * detail, about a cat in the player's own Dex just as readily.
 */
for (const metres of [0, 10, 249, 250, 251, 5000]) {
  const phrases = reasonsFor(metres, ['notched left ear']);
  ok(`no phrase carries a digit at ${metres}m`, !phrases.some((p) => /\d/.test(p)));
}

console.log('\n-- the tunables are the numbers they were argued at --\n');

check('the weights still sum to one', PROXIMITY_WEIGHT + TRAIT_WEIGHT, 1);
check('proximity tiebreaks rather than competes', PROXIMITY_WEIGHT, 0.2);
check('the shortlist draws from every cat seen nearby', SHORTLIST_SCOPE, 'nearby');
check('search radius', SEARCH_RADIUS_M, 300);
check('pool size', POOL_LIMIT, 200);
check('a shortlist is a question, not a list', MAX_CANDIDATES, 5);

console.log('\n-- the identify body --\n');

const UUID = '11111111-2222-4333-8444-555555555555';

ok('an existing cat', identifySchema.safeParse({ catId: UUID }).success);
ok('a new cat', identifySchema.safeParse({ newCat: { nickname: 'Mochi' } }).success);
ok('a nickname is trimmed', identifySchema.safeParse({ newCat: { nickname: '  Mochi  ' } }).success);

/*
 * Trap 16, in the file that learned it. `z.object` strips unknown keys, so a union of two
 * object schemas accepted both branches' keys at once — `{ catId, newCat }` parsed as valid
 * until both became `z.strictObject`. It is a body whose intent genuinely cannot be guessed.
 */
ok('both branches at once is refused', !identifySchema.safeParse({ catId: UUID, newCat: { nickname: 'Mochi' } }).success);
ok('neither branch is refused', !identifySchema.safeParse({}).success);
ok('a non-uuid cat id is refused', !identifySchema.safeParse({ catId: 'the-grey-one' }).success);
ok('an empty nickname is refused', !identifySchema.safeParse({ newCat: { nickname: '   ' } }).success);
ok('an over-long nickname is refused', !identifySchema.safeParse({ newCat: { nickname: 'x'.repeat(31) } }).success);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
