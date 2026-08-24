/**
 * The rate-limit tiers, and the relationships the reasoning behind them depends on.
 *
 *     npx tsx scripts/check-limits.ts
 *
 * Asserting that a constant equals the value written beside it is worth nothing. What is worth
 * checking is the shape of the policy — that the tier guarding paid model calls is tighter than
 * the one guarding reads, that the irreversible action is the tightest thing in the file, that
 * nothing address-keyed is set so low a shared carrier address would meet it. Those are the
 * claims `game/limits.ts` argues for, and they are the ones a later edit can quietly break.
 *
 * No database and no key, like every other check here.
 */

import assert from 'node:assert/strict';

import { RATE_LIMITS, type Tier } from '../src/game/limits.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const tiers = Object.entries(RATE_LIMITS) as [string, Tier][];

/* Every tier is well formed. A zero limit would refuse everybody, including the first caller. */
for (const [name, tier] of tiers) {
  assert.ok(tier.limit > 0, `${name}: limit must be positive`);
  assert.ok(tier.windowMs > 0, `${name}: window must be positive`);
  assert.ok(Number.isInteger(tier.limit), `${name}: limit must be a whole number of requests`);

  /*
   * The message reaches a player, so it is checked like copy rather than like a constant: it
   * has to be a sentence, and it must not name the mechanism. "You have used 30 of 30 requests
   * in a 60000ms window" tells somebody probing exactly what to pace against.
   */
  assert.ok(tier.message.length > 20, `${name}: message must be a sentence`);
  assert.ok(/[.!]$/.test(tier.message), `${name}: message must end as a sentence`);
  assert.ok(
    !/\d/.test(tier.message),
    `${name}: message must not quote the numbers — it tells a caller what to pace against`
  );
}

/* Per-minute rates, so tiers with different windows can be compared at all. */
const perMinute = (t: Tier) => (t.limit / t.windowMs) * MINUTE;

/*
 * The ordering the policy rests on. Reads are the most permissive thing a signed-in caller can
 * do; anything that writes is tighter; anything irreversible is tightest.
 */
assert.ok(
  perMinute(RATE_LIMITS.read) > perMinute(RATE_LIMITS.write),
  'reads must be more permissive than writes'
);
assert.ok(
  perMinute(RATE_LIMITS.write) > perMinute(RATE_LIMITS.costly),
  'writing a row must be cheaper than a call that costs money'
);
assert.ok(
  perMinute(RATE_LIMITS.danger) < perMinute(RATE_LIMITS.social),
  'deleting an account must be the tightest thing in the file'
);
assert.equal(
  Math.min(...tiers.map(([, t]) => perMinute(t))),
  perMinute(RATE_LIMITS.danger),
  'nothing may be tighter than the irreversible tier'
);

/*
 * The flood stop is the outermost ceiling, so it has to sit above every per-player tier —
 * a per-player limit above it could never be reached, which would make it the real policy
 * while looking like a footnote.
 */
for (const [name, tier] of tiers) {
  if (name === 'flood') continue;
  assert.ok(
    perMinute(RATE_LIMITS.flood) >= perMinute(tier),
    `flood must not be tighter than ${name}, or it becomes the real limit`
  );
}

/*
 * Address-keyed tiers carry the NAT argument, and it only holds while they are generous.
 * Carrier-grade NAT puts many thousands of subscribers behind one address; a tier keyed that
 * way and set to a per-person number is an outage for a whole mobile network.
 */
for (const [name, tier] of tiers) {
  if (!tier.byAddress) continue;
  assert.ok(
    perMinute(tier) >= 60,
    `${name}: an address-keyed tier below 60/min will lock out a shared carrier address`
  );
}

/* Only the two tiers with no player behind them key on the address. */
assert.deepEqual(
  tiers.filter(([, t]) => t.byAddress).map(([n]) => n).sort(),
  ['flood', 'public'],
  'only the routes with no authenticated player may key on the address'
);

/*
 * The costly tier is what stands between a caller and the scorer. It has to leave room for an
 * honest session — a walk producing a photograph a minute for an hour — while staying finite.
 */
assert.ok(
  RATE_LIMITS.costly.windowMs >= HOUR,
  'the costly window is a session, not a burst'
);
assert.ok(
  RATE_LIMITS.costly.limit >= 60,
  'a photograph a minute for an hour is an honest session and must not be refused'
);

console.log('check-limits: ok');
