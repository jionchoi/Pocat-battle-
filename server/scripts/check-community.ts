/**
 * The community layer's arithmetic, checked without a database.
 *
 *     cd server && npx tsx scripts/check-community.ts
 *
 * The smoothing block is the reason this exists. `communityScore` decides the ordering of the
 * ranked feed and, through it, Photographer Rank — so its failure mode is not a wrong pixel,
 * it is a leaderboard that rewards the wrong thing, which nobody would notice from the app.
 */

import { readFileSync } from 'node:fs';

import {
  MAX_VOTES_PER_DAY,
  MIN_VIEWS_FOR_CONFIDENCE,
  PRIOR_RATIO,
  SCORE_SCALE,
  communityScore,
  emptyReactions,
  isReaction,
  widerWindow,
  windowCutoff,
} from '../src/game/community.js';

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

console.log('\n-- the smoothed ratio --\n');

check('nothing seen, nothing said: the prior', communityScore(0, 0), PRIOR_RATIO * SCORE_SCALE);

/*
 * The reason smoothing exists at all. A raw votes/views would score this 1000 — a perfect
 * photograph — on the strength of one enthusiastic friend, and it would outrank everything
 * on the platform forever.
 */
const oneOfOne = communityScore(1, 1);
ok(`1 reaction from 1 viewer is not a perfect score (got ${oneOfOne})`, oneOfOne < 200);

/* And the other end: real evidence has to be able to overcome the prior. */
const ninetyPercent = communityScore(900, 1000);
ok(`900 of 1000 lands near 90% (got ${ninetyPercent})`, ninetyPercent > 880 && ninetyPercent < 900);

/*
 * The monotonic properties. Neither is obvious from the formula and both would be felt
 * immediately if they broke: reactions must help, and views without reactions must not.
 */
ok('more reactions on the same views scores higher', communityScore(20, 100) > communityScore(10, 100));
ok('more views without more reactions scores lower', communityScore(10, 200) < communityScore(10, 100));

/*
 * Evidence outweighs the assumption at exactly the point the client starts showing a
 * percentage. That alignment is deliberate — see PRIOR_WEIGHT.
 */
const halfWay = communityScore(MIN_VIEWS_FOR_CONFIDENCE, MIN_VIEWS_FOR_CONFIDENCE);
ok(
  `at ${MIN_VIEWS_FOR_CONFIDENCE} views the score is about half evidence, half prior (got ${halfWay})`,
  halfWay > 500 && halfWay < 560
);

console.log('\n-- clamping --\n');

/*
 * Impressions are best-effort: the client batches them and flushes on unmount, so a dropped
 * batch can leave a photo with more reactions than recorded viewers. Unclamped that is a ratio
 * above 1 and a score no honest photograph could reach.
 */
check('more votes than views cannot exceed the scale', communityScore(50, 1), SCORE_SCALE);
check('negative votes are floored, not propagated', communityScore(-5, 100), communityScore(0, 100));
check('negative views are floored too', communityScore(5, -100), communityScore(5, 0));
ok('the result is always an integer', Number.isInteger(communityScore(7, 33)));
ok('never below zero', communityScore(0, 1_000_000) >= 0);

console.log('\n-- reactions --\n');

check('a fresh tally is all zeroes', emptyReactions(), { laugh: 0, love: 0, wow: 0 });
ok('laugh is a reaction', isReaction('laugh'));
ok('love is a reaction', isReaction('love'));
ok('wow is a reaction', isReaction('wow'));
ok('an invented reaction is refused', !isReaction('angry'));
ok('a non-string is refused', !isReaction(3));

console.log('\n-- the ranked window --\n');

const now = new Date('2026-08-12T12:00:00.000Z');
check('today is 24h back', windowCutoff('today', now), '2026-08-11T12:00:00.000Z');
check('week is 7 days back', windowCutoff('week', now), '2026-08-05T12:00:00.000Z');
check('all time has no cutoff', windowCutoff('all', now), null);

check('today widens to week', widerWindow('today'), 'week');
check('week widens to all', widerWindow('week'), 'all');
check('all time is the widest there is', widerWindow('all'), null);

console.log('\n-- mirrored constants, so the two copies must agree --\n');

/*
 * `constants/game.ts` is a React Native module and will not import under plain tsx, so the
 * values are read as text. What is being checked is the numbers, not the module.
 */
const clientSource = readFileSync(
  new URL('../../src/constants/game.ts', import.meta.url),
  'utf8'
);

for (const [key, ours] of [
  ['minViewsForConfidence', MIN_VIEWS_FOR_CONFIDENCE],
  ['maxVotesPerDay', MAX_VOTES_PER_DAY],
  ['scoreScale', SCORE_SCALE],
] as const) {
  const match = clientSource.match(new RegExp(`${key}:\\s*([\\d_]+)`));

  if (!match) {
    failures += 1;
    console.log(`FAIL  could not find ${key} in the client — has it moved or been renamed?`);
  } else {
    check(`client and server agree on ${key}`, Number(match[1]!.replace(/_/g, '')), ours);
  }
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
