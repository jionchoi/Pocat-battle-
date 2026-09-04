/**
 * The rank ramp, checked without a database.
 *
 * `game/progression.ts` is pure arithmetic, which is the whole reason it is in `game/` — it
 * decides what a photograph is worth and what rank that buys, and neither question needs a
 * Supabase project to answer. Run it with:
 *
 *     cd server && npx tsx scripts/check-progression.ts
 *
 * The last block is the one worth keeping: it checks this file's copy of `RANK_TIERS` against
 * the client's, because they are two copies of one constant and nothing else would notice
 * them drifting apart.
 */

import {
  FOREIGN_REVEAL_XP_MULTIPLIER,
  RANK_TIERS,
  rankForXp,
  rankTitle,
  xpForRevealingAnother,
  xpForScore,
  xpToNextRank,
} from '../src/game/progression.js';

let failures = 0;

function ok(label: string, condition: boolean): void {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
}

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

console.log('\n-- what a photograph is worth --\n');

check('a score is its own XP', xpForScore(72), 72);
check('zero is a real score and earns zero', xpForScore(0), 0);
/*
 * Above 100 is expected rather than a bug — the rubric's ranges are guidance, not caps — so
 * this must not clamp. A ceiling here would silently cost a player their best shot.
 */
check('no ceiling at 100', xpForScore(137), 137);
check('a fractional total rounds rather than truncating', xpForScore(72.6), 73);
/*
 * Neither of these should ever arrive. They are refused rather than clamped because both
 * mean something upstream is broken, and rounding them away is how that stays hidden.
 */
check('a negative total earns nothing', xpForScore(-40), 0);
check('NaN earns nothing', xpForScore(Number.NaN), 0);

console.log('\n-- unlocking somebody else’s score --\n');

/*
 * A paid reveal pays two people and the unlocker gets more. Both halves are checked here
 * because the relationship between them is the rule, not either number on its own: the
 * photographer is paid `xpForScore` (that is `awardForScore`, unchanged), and the unlocker is
 * paid this.
 */
check(
  'unlocking pays a multiple of the score',
  xpForRevealingAnother(60),
  60 * FOREIGN_REVEAL_XP_MULTIPLIER
);

/*
 * The whole point of the bonus: it has to be worth more than revealing one of your own, or
 * spending paws on somebody else's photograph pays the same as spending nothing on yours.
 */
ok(
  'unlocking somebody else’s beats revealing your own',
  xpForRevealingAnother(60) > xpForScore(60)
);

/*
 * And it holds across the range, not just at one convenient score. The photographer is paid
 * `xpForScore`, so this is the same comparison at every total a photograph can reach — the
 * failure it guards is a multiplier that rounds away to nothing on small scores.
 */
ok(
  'the unlocker is paid more than the photographer at every score',
  [1, 7, 42, 60, 99, 137].every((total) => xpForRevealingAnother(total) > xpForScore(total))
);

ok(
  'the multiplier is greater than one, or the bonus is not a bonus',
  FOREIGN_REVEAL_XP_MULTIPLIER > 1
);

/* Refusals are inherited rather than restated: a broken score is worth nothing to anybody. */
check('a negative total unlocks nothing', xpForRevealingAnother(-40), 0);
check('NaN unlocks nothing', xpForRevealingAnother(Number.NaN), 0);

/*
 * Rounded once, at the end. A fractional multiplier on an odd score must not put a fraction
 * into a column that holds whole numbers — and `xp` is read straight into the rank ramp, so a
 * non-integer there would propagate into every threshold comparison.
 */
ok('the result is always a whole number', Number.isInteger(xpForRevealingAnother(72.6)));

console.log('\n-- the ramp --\n');

check('a new account is rank 1', rankForXp(0), 1);
check('one xp short of rank 2', rankForXp(249), 1);
check('exactly the threshold promotes', rankForXp(250), 2);
check('well past a threshold does not skip ahead', rankForXp(699), 2);
check('two thresholds at once', rankForXp(1_500), 4);
check('past the top of the ramp stays at the top', rankForXp(10_000_000), 12);

check('titles come off the tier', rankTitle(2), 'Stray Spotter');
check('an unknown rank falls back rather than throwing', rankTitle(99), 'Newcomer');

console.log('\n-- distance to the next tier --\n');

check('from a standing start', xpToNextRank(0, 1), 250);
check('part way up', xpToNextRank(100, 1), 150);
check('on the threshold of the next', xpToNextRank(700, 3), 800);
check('the top of the ramp has nowhere to go', xpToNextRank(45_000, 12), 0);
/*
 * Only reachable if the ramp is retuned downward under an existing player. It must read as
 * zero rather than a negative number, which would render as a meter running backwards.
 */
check('never negative', xpToNextRank(9_999, 2), 0);

console.log('\n-- the ramp is mirrored, so the two copies must agree --\n');

/*
 * The client's copy, read as text rather than imported.
 *
 * `src/constants/game.ts` is a React Native module that pulls in the theme and the rest of
 * the app, none of which will load under plain tsx — and the thing being checked is the data,
 * not the module. Parsing the literal is what makes this runnable from the server at all.
 */
import { readFileSync } from 'node:fs';

const clientSource = readFileSync(
  new URL('../../src/constants/game.ts', import.meta.url),
  'utf8'
);

const block = clientSource.match(/RANK_TIERS[^=]*=\s*\[([\s\S]*?)\];/);

if (!block) {
  failures += 1;
  console.log('FAIL  could not find RANK_TIERS in the client — has it moved or been renamed?');
} else {
  const clientTiers = [...block[1]!.matchAll(
    /\{\s*rank:\s*(\d+),\s*title:\s*'([^']*)',\s*xpRequired:\s*([\d_]+)\s*\}/g
  )].map((m) => ({
    rank: Number(m[1]),
    title: m[2]!,
    xpRequired: Number(m[3]!.replace(/_/g, '')),
  }));

  check('same number of tiers', clientTiers.length, RANK_TIERS.length);
  check('every tier matches, rank for rank', clientTiers, RANK_TIERS.map((t) => ({ ...t })));
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
