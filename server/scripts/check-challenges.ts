/**
 * Challenge rules, checked without a database.
 *
 *     cd server && npx tsx scripts/check-challenges.ts
 *
 * Two of these are date arithmetic, which is the reason this file matters more than most: code
 * that is only ever run against the real "now" is code whose boundaries nobody has looked at.
 * Every case below pins an explicit clock.
 */

import { captureStreak, pickWinner, statusOf, type Entrant } from '../src/game/challenges.js';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  if (!good) failures += 1;
  console.log(
    `${good ? 'PASS' : 'FAIL'}  ${label}` +
      (good ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

const START = '2026-08-10T00:00:00.000Z';
const END = '2026-08-17T00:00:00.000Z';

console.log('\n-- where a challenge is in its life --\n');

check('before it opens', statusOf(START, END, new Date('2026-08-09T23:59:59.000Z')), 'upcoming');
check('the instant it opens', statusOf(START, END, new Date(START)), 'active');
check('the middle of the week', statusOf(START, END, new Date('2026-08-13T12:00:00.000Z')), 'active');
check('one second before it ends', statusOf(START, END, new Date('2026-08-16T23:59:59.000Z')), 'active');

/*
 * Half-open at the end, on purpose. Somebody submitting on the final second gets a clear
 * refusal rather than an entry whose validity depends on which clock read the row.
 */
check('the instant it ends', statusOf(START, END, new Date(END)), 'closed');
check('long after', statusOf(START, END, new Date('2026-09-01T00:00:00.000Z')), 'closed');

console.log('\n-- picking a winner --\n');

const entrants: Entrant[] = [
  { photoId: 'a', scoreTotal: 90, communityScore: 200, voteCount: 2 },
  { photoId: 'b', scoreTotal: 70, communityScore: 800, voteCount: 40 },
  { photoId: 'c', scoreTotal: null, communityScore: 900, voteCount: 60 },
];

check('an objective prompt ranks on the score', pickWinner(entrants, 'score'), 'a');

/*
 * The interesting half. `c` has no score at all and wins on votes, which is exactly the case
 * "subjective prompts fall back to what people thought" exists for.
 */
check('a subjective prompt ranks on the smoothed ratio', pickWinner(entrants, 'votes'), 'c');

/*
 * And it must not win a score challenge. A null is not a zero — treating it as one ranks it
 * last silently, and treating it as anything else invents a verdict nobody reached.
 */
check(
  'an unscored photo cannot win on score',
  pickWinner([{ photoId: 'x', scoreTotal: null, communityScore: 999, voteCount: 99 }], 'score'),
  null
);

check('nothing entered, nothing awarded', pickWinner([], 'votes'), null);

/*
 * A total ordering, so a challenge settled twice names the same winner both times. Without the
 * id fallback the answer would depend on the order Postgres happened to return rows.
 */
const tied: Entrant[] = [
  { photoId: 'zeta', scoreTotal: 80, communityScore: 500, voteCount: 5 },
  { photoId: 'alpha', scoreTotal: 80, communityScore: 500, voteCount: 5 },
];
check('a total tie falls through to the id', pickWinner(tied, 'score'), 'alpha');
check('and does so the same way whatever the input order', pickWinner([...tied].reverse(), 'score'), 'alpha');

/* The ratio beats the raw count, so a challenge is not won by posting at the busiest hour. */
check(
  'exposure does not beat a better ratio',
  pickWinner(
    [
      { photoId: 'seen-by-everyone', scoreTotal: 50, communityScore: 300, voteCount: 400 },
      { photoId: 'seen-by-few', scoreTotal: 50, communityScore: 700, voteCount: 40 },
    ],
    'votes'
  ),
  'seen-by-few'
);

console.log('\n-- the capture streak --\n');

const noon = new Date('2026-08-12T12:00:00.000Z');
const on = (...days: string[]) => days.map((d) => `${d}T09:00:00.000Z`);

check('no captures at all', captureStreak([], noon), 0);
check('today only', captureStreak(on('2026-08-12'), noon), 1);
check('three days running', captureStreak(on('2026-08-12', '2026-08-11', '2026-08-10'), noon), 3);
check('several on one day still counts once', captureStreak(
  [...on('2026-08-12'), '2026-08-12T18:00:00.000Z', ...on('2026-08-11')],
  noon
), 2);

/*
 * The kindness case, and the one worth getting right. Somebody who has not photographed a cat
 * yet this morning has not broken a nine-day run — telling them they have, at breakfast, is
 * the version of this feature that makes people stop opening the app.
 */
check('yesterday still counts before today has happened', captureStreak(on('2026-08-11', '2026-08-10'), noon), 2);

check('a gap ends the run', captureStreak(on('2026-08-12', '2026-08-10', '2026-08-09'), noon), 1);
check('a run that ended two days ago is over', captureStreak(on('2026-08-10', '2026-08-09'), noon), 0);
check('unordered input is fine', captureStreak(on('2026-08-10', '2026-08-12', '2026-08-11'), noon), 3);

/* Month and year boundaries are where naive day arithmetic breaks. */
check(
  'across a month boundary',
  captureStreak(on('2026-09-01', '2026-08-31', '2026-08-30'), new Date('2026-09-01T12:00:00.000Z')),
  3
);
check(
  'across a year boundary',
  captureStreak(on('2027-01-01', '2026-12-31'), new Date('2027-01-01T12:00:00.000Z')),
  2
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
