/**
 * The shop catalogue and its entitlement rule, checked without a database.
 *
 * `GET /shop/catalog` is a read whose only interesting part is `owned`, and `owned` is a pure
 * function of a rank and a boolean — so all of it can be exercised here, with no project and no
 * key. What the service adds is one query for those two values.
 *
 *     cd server && npx tsx scripts/check-shop.ts
 *
 * Exits non-zero on any failure.
 *
 * The last section is the one worth keeping. It asserts that nothing purchasable can report
 * itself as owned, because there is no entitlements table yet and `POST /shop/purchase` is
 * deliberately unbuilt — so the day somebody builds it, this file fails and says why.
 */

import {
  CATALOG,
  catalogFor,
  ownsEntry,
  unlockRefusal,
  type CatalogEntry,
  type Entitlements,
  type ShopItemKind,
} from '../src/game/shop.js';

/**
 * An `Entitlements` for a player who has bought nothing and has no paws.
 *
 * Most of this file is about rank and Pro, which is where entitlement came from before paws
 * existed — so the two newer fields default to "owns nothing, can afford nothing" and the
 * cases that care about them pass their own. That keeps the older checks reading as they did
 * while making it impossible to write one that silently omits the new fields.
 */
function who(
  rank: number,
  proActive: boolean,
  unlockedIds: readonly string[] = [],
  walletBalance = 0
): Entitlements {
  return { rank, proActive, unlockedIds, walletBalance };
}

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
      (ok
        ? ''
        : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`)
  );
}

const entry = (id: string): CatalogEntry => {
  const found = CATALOG.find((e) => e.id === id);
  if (!found) throw new Error(`no catalogue entry '${id}' — the check needs updating`);
  return found;
};

const KINDS: ShopItemKind[] = ['filter', 'frame', 'theme', 'pro'];

console.log('\n-- the catalogue is well formed --\n');

check('every id is unique', new Set(CATALOG.map((e) => e.id)).size, CATALOG.length);
check(
  'every kind is one the client knows',
  CATALOG.every((e) => KINDS.includes(e.kind)),
  true
);
check(
  'nothing has a negative rank requirement',
  CATALOG.every((e) => e.requiredRank >= 0),
  true
);
check(
  'every item has a name and a description',
  CATALOG.every((e) => e.name.trim() !== '' && e.description.trim() !== ''),
  true
);

/*
 * The screen filters by kind and draws its own empty state per tab. A tab with nothing in it is
 * handled rather than broken — but all four being empty is indistinguishable from the endpoint
 * failing, which is the reason the catalogue is seeded at all.
 */
for (const kind of KINDS) {
  check(
    `the ${kind} tab has something in it`,
    CATALOG.some((e) => e.kind === kind),
    true
  );
}

console.log('\n-- sold and earned are exclusive, and the screen depends on it --\n');

/*
 * `ShopScreen.tsx` branches on `requiredRank`: above zero it draws a rank badge and never a
 * price, at zero it draws a price on a buy button. An item with both would be offered for sale
 * *and* described as earned, and only one of those can be true.
 */
check(
  'anything rank-gated carries no price',
  CATALOG.filter((e) => e.requiredRank > 0).every((e) => e.priceLabel === ''),
  true
);
check(
  'anything rank-gated carries no product id',
  CATALOG.filter((e) => e.requiredRank > 0).every((e) => e.productId === ''),
  true
);
check(
  'anything for sale carries both a price and a product id',
  CATALOG.filter((e) => e.requiredRank === 0).every(
    (e) => e.priceLabel !== '' && e.productId !== ''
  ),
  true
);

console.log('\n-- rank unlocks --\n');

const NEW_PLAYER = who(1, false);

check('a rank-1 item is owned by a new account', ownsEntry(entry('filter-natural'), NEW_PLAYER), true);
check('a rank-4 item is not', ownsEntry(entry('filter-golden-hour'), NEW_PLAYER), false);
check(
  'reaching the rank unlocks it',
  ownsEntry(entry('filter-golden-hour'), who(4, false)),
  true
);
check(
  'one short does not',
  ownsEntry(entry('filter-golden-hour'), who(3, false)),
  false
);
check(
  'past the rank stays unlocked',
  ownsEntry(entry('filter-golden-hour'), who(40, false)),
  true
);

console.log('\n-- Pro is a column, not a rank --\n');

check('Pro is not owned without the subscription', ownsEntry(entry('pro-subscription'), who(99, false)), false);
check('Pro is owned with it', ownsEntry(entry('pro-subscription'), who(1, true)), true);

/*
 * Pro lifts the album cap and the reveal allowance. It does not hand over the cosmetics, and
 * that is a product decision rather than an oversight — the rank-gated items are the visible
 * record of having taken photographs, and selling them would empty that out.
 */
check(
  'Pro does not unlock a rank-gated cosmetic',
  ownsEntry(entry('frame-brass'), who(1, true)),
  false
);

console.log('\n-- a bought cosmetic is owned, and only then --\n');

/*
 * This block used to assert the opposite.
 *
 * It read "nothing purchasable can be owned yet", and its comment said that was true only
 * while there was nowhere for a purchase to be recorded — and that the day it failed, somebody
 * had built purchasing and `ownsEntry` needed a table to read. The 2026-08-30 migration is
 * that table, so the check is inverted rather than deleted: what has to be true now is that
 * ownership follows the entitlement and nothing else.
 *
 * Note what is unchanged. `POST /shop/purchase` is still unbuilt — the **money** door is still
 * shut. What opened is the paw door, `POST /shop/unlock`.
 */
const richest = who(999, true);

for (const e of CATALOG.filter((c) => c.requiredRank === 0 && c.kind !== 'pro')) {
  check(
    `'${e.id}' is not owned at rank 999 with Pro and nothing bought`,
    ownsEntry(e, richest),
    false
  );
  check(
    `'${e.id}' is owned once it is in entitlements`,
    ownsEntry(e, who(1, false, [e.id])),
    true
  );
}

/*
 * An entitlement for something else does not unlock this one, which sounds obvious and is the
 * exact failure a `.length > 0` check would produce.
 */
check(
  'owning one item does not unlock another',
  ownsEntry(entry('filter-monochrome'), who(1, false, ['theme-contact-sheet'])),
  false
);

/*
 * You cannot buy your way past a rank gate, and this is the check that says so.
 *
 * The rank branch answers first and short-circuits, so an `entitlements` row naming a
 * rank-gated item is simply ignored — a rank-4 filter stays locked at rank 1 whatever is in
 * that table. That matters because the table is the one place a bad write could grant
 * something: `unlockRefusal` will not sell a rank item, but a support script, a bad
 * migration or a future code path might still put a row there, and this is what makes that
 * row inert rather than a silent unlock.
 */
check(
  'an entitlement row cannot unlock a rank-gated item early',
  ownsEntry(entry('filter-golden-hour'), who(1, false, ['filter-golden-hour'])),
  false
);
check(
  'and reaching the rank is still what unlocks it',
  ownsEntry(entry('filter-golden-hour'), who(4, false, [])),
  true
);

console.log('\n-- what may be bought with paws --\n');

/*
 * `pawPrice: null` is the default and the safe value: adding a filter to the catalogue must
 * not make it buyable by accident. Exactly one entry is priced today, and that is deliberate —
 * it exists so the unlock path is reachable on a device rather than being a branch nothing
 * ever enters.
 */
const priced = CATALOG.filter((e) => e.pawPrice !== null);

check('exactly one entry is priced in paws today', priced.length, 1);
check('and it is the worked example', priced[0]?.id, 'filter-monochrome');

ok(
  'every paw price is a positive whole number',
  priced.every((e) => Number.isInteger(e.pawPrice) && (e.pawPrice ?? 0) > 0)
);

/*
 * The one that must never change.
 *
 * Pro lifts the album cap and the reveal allowance — it is the single entry in this catalogue
 * that is not cosmetic. A paw price on it would make the currency buy *power*, which is the
 * sentence the whole product is built not to say, and it would do so quietly: the row would
 * simply start showing a paw button.
 */
ok(
  'Pro is not purchasable with paws, and must never be',
  CATALOG.filter((e) => e.kind === 'pro').every((e) => e.pawPrice === null)
);

/*
 * A rank-gated item is earned, never sold — for either currency. Selling one would empty out
 * the visible record of having taken photographs, which is the whole point of gating on rank.
 */
ok(
  'nothing rank-gated carries a paw price',
  CATALOG.filter((e) => e.requiredRank > 0).every((e) => e.pawPrice === null)
);

console.log('\n-- unlock refusals, in order --\n');

const monochrome = entry('filter-monochrome');
const price = monochrome.pawPrice ?? 0;

check('an unknown id is refused first', unlockRefusal(undefined, who(1, false, [], 999)), 'unknown_item');

check(
  'something already bought is refused before the price is looked at',
  unlockRefusal(monochrome, who(1, false, ['filter-monochrome'], 0)),
  'already_owned'
);

/*
 * The ordering that matters. A rank-gated item is *owned* once the rank is reached, so a rich
 * player at rank 40 must be told they already have it rather than that it is not for sale —
 * and a player below the rank must be told it is not for sale rather than that they are poor.
 */
check(
  'a rank item you have reached reads as owned, not as unsellable',
  unlockRefusal(entry('filter-golden-hour'), who(40, false, [], 999)),
  'already_owned'
);
check(
  'a rank item you have not reached is simply not for paws',
  unlockRefusal(entry('filter-golden-hour'), who(1, false, [], 999)),
  'not_for_paws'
);

check(
  'Pro is refused as not-for-paws however rich you are',
  unlockRefusal(entry('pro-subscription'), who(1, false, [], 999_999)),
  'not_for_paws'
);

check(
  'an affordable priced item is not refused',
  unlockRefusal(monochrome, who(1, false, [], price)),
  null
);
check(
  'one paw short is refused',
  unlockRefusal(monochrome, who(1, false, [], price - 1)),
  'insufficient_paws'
);

/*
 * The grant is not a parameter of any of this, and cannot be — `Entitlements` carries a
 * wallet balance and nothing else. Spending the weekly grant would break the rule that giving
 * costs nothing, and the type is what enforces it rather than a comment somewhere.
 */
ok(
  'affordability reads a wallet, and there is nowhere to pass a grant',
  !('grant' in who(1, false, [], 10))
);

console.log('\n-- the whole response, for one player --\n');

const items = catalogFor(who(7, false));

check('every catalogue entry comes back', items.length, CATALOG.length);
check(
  'owned is added to every one of them',
  items.every((i) => typeof i.owned === 'boolean'),
  true
);
check(
  'a rank-7 player owns exactly the rank-gated items at or below 7',
  items.filter((i) => i.owned).map((i) => i.id),
  CATALOG.filter((e) => e.requiredRank > 0 && e.requiredRank <= 7).map((e) => e.id)
);
check(
  'the authored catalogue is not mutated by serving it',
  CATALOG.every((e) => !('owned' in e)),
  true
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
