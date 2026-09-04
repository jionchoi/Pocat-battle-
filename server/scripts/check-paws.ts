/**
 * The paw economy's rules, checked without a database.
 *
 *     cd server && npx tsx scripts/check-paws.ts
 *
 * Three of the blocks below are here because their failure modes are *silent and about money*,
 * which is the worst pair available:
 *
 *   - the **period roll**, where drifting the anchor or carrying paws over would not throw
 *     anything, would not look wrong on a screen, and would quietly change how much currency
 *     the product hands out per player per year;
 *   - the **bucket choice**, where getting it backwards spends the paws that do not expire
 *     first and destroys the ones that do — invisible until a player notices their weekly
 *     grant evaporating;
 *   - the **wallet sum**, where counting the grant's own ledger rows would deduct every weekly
 *     paw from a balance it never came out of.
 *
 * There is no undo block. A gift is final — see the note at the top of `game/paws.ts` — so
 * there is no reversal to get wrong.
 *
 * The mirror block at the end is the same guard `check-community.ts` runs, for the same
 * reason: the client draws "6 left this week" from its own copy of the grant size.
 */

import { readFileSync } from 'node:fs';

import {
  PAW_GIFT_SIZE,
  PAW_GRANT,
  PAW_GRANT_WINDOW_HOURS,
  PAW_GRANT_WINDOW_MS,
  PAW_REVEAL_COST,
  canAfford,
  chooseBucket,
  grantResetsAt,
  nextPawCount,
  refuseGift,
  rollGrant,
  walletBalance,
  type PawMovement,
} from '../src/game/paws.js';

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

/* A fixed clock, so every case below is a stated time rather than "now". */
const NOW = new Date('2026-08-29T12:00:00.000Z');
const HOUR = 3600_000;

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

console.log('\n-- the shape of the economy --\n');

ok('the grant is a positive whole number of paws', Number.isInteger(PAW_GRANT) && PAW_GRANT > 0);
ok('the grant window is a positive number of hours', PAW_GRANT_WINDOW_HOURS > 0);
check('the window in ms follows from the hours', PAW_GRANT_WINDOW_MS, PAW_GRANT_WINDOW_HOURS * HOUR);
check('one tap gives one paw', PAW_GIFT_SIZE, 1);

console.log('\n-- the grant period rolls --\n');

const fresh = rollGrant(null, NOW);
check('a player with no row starts a full period now', fresh, {
  periodStart: NOW.toISOString(),
  remaining: PAW_GRANT,
  changed: true,
});

const midPeriod = rollGrant({ periodStart: ago(2 * HOUR), remaining: 3 }, NOW);
check('a period that has not turned is left exactly alone', midPeriod, {
  periodStart: ago(2 * HOUR),
  remaining: 3,
  changed: false,
});

/*
 * The boundary itself. `>=` rather than `>`, so a period that has run its full length has
 * turned — an off-by-one here means the grant lands an entire window late, once, for
 * whichever players happen to read at exactly the wrong moment.
 */
const justUnder = rollGrant({ periodStart: ago(PAW_GRANT_WINDOW_MS - 1), remaining: 0 }, NOW);
ok('one millisecond before the window closes, nothing has changed', !justUnder.changed);

const exactly = rollGrant({ periodStart: ago(PAW_GRANT_WINDOW_MS), remaining: 0 }, NOW);
ok('at exactly one window, the grant has rolled', exactly.changed);
check('a rolled period is full again', exactly.remaining, PAW_GRANT);

/*
 * The anchor moves by whole windows, never to now. This is the property that keeps a
 * player's reset at the same hour every week however irregularly they open the app — and it
 * is invisible if it breaks, because a drifting anchor still hands out the right amount.
 */
const lateBy = 3 * HOUR;
const late = rollGrant({ periodStart: ago(PAW_GRANT_WINDOW_MS + lateBy), remaining: 1 }, NOW);
check(
  'the anchor rolls by exactly one window, not to now',
  late.periodStart,
  ago(lateBy)
);
ok(
  'so the reset stays on its original cadence',
  (Date.parse(grantResetsAt(late.periodStart)) - Date.parse(late.periodStart)) ===
    PAW_GRANT_WINDOW_MS
);

/* Three whole periods away is still one grant. Unused paws never accumulate. */
const longAbsence = rollGrant(
  { periodStart: ago(3 * PAW_GRANT_WINDOW_MS + HOUR), remaining: 2 },
  NOW
);
check('three periods away is still one grant, not three', longAbsence.remaining, PAW_GRANT);
check(
  'and the anchor skips whole windows rather than resetting to now',
  longAbsence.periodStart,
  ago(HOUR)
);

/* Two rows a player can only reach through corruption, and both must self-repair. */
const future = rollGrant({ periodStart: '2027-01-01T00:00:00.000Z', remaining: 0 }, NOW);
check('an anchor in the future is repaired, not rolled backwards', future.periodStart, NOW.toISOString());
check('and it is repaired to a full grant', future.remaining, PAW_GRANT);

const garbage = rollGrant({ periodStart: 'not a date', remaining: 4 }, NOW);
check('an unparseable anchor is repaired too', garbage.periodStart, NOW.toISOString());

check(
  'the reset is one window after the anchor',
  grantResetsAt(NOW.toISOString()),
  new Date(NOW.getTime() + PAW_GRANT_WINDOW_MS).toISOString()
);

console.log('\n-- which bucket a gift comes out of --\n');

/*
 * Grant first, always. Wallet-first is strictly worse for the player in every state the two
 * can be in, because grant paws expire and wallet paws do not — so this is not a preference,
 * it is the only correct answer, and the client is never asked.
 */
check('with both, the expiring one is spent', chooseBucket(7, 100), 'grant');
check('with one grant paw left, it is still the grant', chooseBucket(1, 100), 'grant');
check('with the grant empty, it falls through to the wallet', chooseBucket(0, 3), 'wallet');
check('with nothing anywhere, there is no bucket', chooseBucket(0, 0), null);
check('a negative grant does not count as having one', chooseBucket(-1, 5), 'wallet');
check('and a negative wallet is not spendable either', chooseBucket(0, -2), null);

console.log('\n-- the wallet is summed from the ledger --\n');

const movement = (
  over: Partial<PawMovement> & Pick<PawMovement, 'delta' | 'reason' | 'bucket'>
): PawMovement => ({ createdAt: ago(HOUR), ...over });

check('an empty ledger is an empty wallet', walletBalance([]), 0);

check(
  'received paws add up',
  walletBalance([
    movement({ delta: 1, reason: 'gift_received', bucket: 'wallet' }),
    movement({ delta: 1, reason: 'gift_received', bucket: 'wallet' }),
    movement({ delta: -1, reason: 'gift_sent', bucket: 'wallet' }),
  ]),
  1
);

/*
 * The one that would be wrong silently. Grant spending writes a ledger row too — so the table
 * is a complete history — and counting those rows against the wallet would deduct every
 * weekly paw from a balance it never came out of.
 */
check(
  'grant rows are history, not wallet balance',
  walletBalance([
    movement({ delta: 1, reason: 'gift_received', bucket: 'wallet' }),
    movement({ delta: -1, reason: 'gift_sent', bucket: 'grant' }),
    movement({ delta: -1, reason: 'gift_sent', bucket: 'grant' }),
  ]),
  1
);

check(
  'a purchase and a prize are wallet money',
  walletBalance([
    movement({ delta: 50, reason: 'purchase', bucket: 'wallet' }),
    movement({ delta: 25, reason: 'challenge_prize', bucket: 'wallet' }),
  ]),
  75
);

/*
 * Spending shows up as a negative wallet row, so a reveal and an unlock both come straight out
 * of the same sum a received gift went into. There is no second balance to keep in step.
 */
check(
  'reveals and purchases come out of the same wallet gifts go into',
  walletBalance([
    movement({ delta: 10, reason: 'gift_received', bucket: 'wallet' }),
    movement({ delta: -PAW_REVEAL_COST, reason: 'reveal', bucket: 'wallet' }),
    movement({ delta: -4, reason: 'purchase', bucket: 'wallet' }),
  ]),
  10 - PAW_REVEAL_COST - 4
);

/*
 * And a grant-funded gift still does not touch it. This is the pairing that would break if
 * somebody ever made spending fall through to the grant: the wallet would be right and the
 * grant would be silently drained.
 */
check(
  'spending never reaches the grant, so grant rows stay out of the wallet sum',
  walletBalance([
    movement({ delta: 5, reason: 'gift_received', bucket: 'wallet' }),
    movement({ delta: -1, reason: 'gift_sent', bucket: 'grant' }),
    movement({ delta: -PAW_REVEAL_COST, reason: 'reveal', bucket: 'wallet' }),
  ]),
  5 - PAW_REVEAL_COST
);

check(
  'a wallet that would go negative is floored',
  walletBalance([movement({ delta: -5, reason: 'gift_sent', bucket: 'wallet' })]),
  0
);

console.log('\n-- refusals --\n');

check('a photo that does not exist', refuseGift('me', null), 'not_found');
check(
  'a photo that is not shared',
  refuseGift('me', { ownerId: 'them', sharedToFeed: false }),
  'not_found'
);
check(
  'your own photo, even when it is shared',
  refuseGift('me', { ownerId: 'me', sharedToFeed: true }),
  'own_photo'
);
check(
  'somebody else’s shared photo is fine',
  refuseGift('me', { ownerId: 'them', sharedToFeed: true }),
  null
);

/*
 * Your own photo is refused *before* the balance is considered, and both buckets are refused
 * alike. There is no version of self-tipping that is allowed for wallet paws — the check is
 * about whose photograph it is, not about which pocket the paw is in.
 */
check(
  'an unshared photo of your own is still just not found',
  refuseGift('me', { ownerId: 'me', sharedToFeed: false }),
  'not_found'
);

console.log('\n-- the photo’s displayed count --\n');

check('a gift adds one', nextPawCount(4, 1), 5);
check('a support reversal takes one back', nextPawCount(4, -1), 3);
check('and it cannot go below zero', nextPawCount(0, -1), 0);
check('a null-ish current count starts from zero', nextPawCount(Number.NaN, 1), 1);

console.log('\n-- mirrored constants, so the two copies must agree --\n');

/*
 * `constants/game.ts` is a React Native module and will not import under plain tsx, so the
 * values are read as text — the same approach `check-community.ts` takes, and for the same
 * reason. What is being checked is the numbers, not the module.
 *
 * This matters more here than it does for the community constants. Those drive a label; these
 * drive what the confirmation toast tells a player about their own money. A client granting
 * itself a different number would say "6 left this week" over a server that granted five, and
 * the player would find out by running out a paw early.
 */
const clientSource = readFileSync(new URL('../../src/constants/game.ts', import.meta.url), 'utf8');

for (const [key, ours] of [
  ['grant', PAW_GRANT],
  ['grantWindowHours', PAW_GRANT_WINDOW_HOURS],
  ['revealCost', PAW_REVEAL_COST],
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
