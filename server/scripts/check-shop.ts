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
  type CatalogEntry,
  type ShopItemKind,
} from '../src/game/shop.js';

let failures = 0;

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

const NEW_PLAYER = { rank: 1, proActive: false };

check('a rank-1 item is owned by a new account', ownsEntry(entry('filter-natural'), NEW_PLAYER), true);
check('a rank-4 item is not', ownsEntry(entry('filter-golden-hour'), NEW_PLAYER), false);
check(
  'reaching the rank unlocks it',
  ownsEntry(entry('filter-golden-hour'), { rank: 4, proActive: false }),
  true
);
check(
  'one short does not',
  ownsEntry(entry('filter-golden-hour'), { rank: 3, proActive: false }),
  false
);
check(
  'past the rank stays unlocked',
  ownsEntry(entry('filter-golden-hour'), { rank: 40, proActive: false }),
  true
);

console.log('\n-- Pro is a column, not a rank --\n');

check('Pro is not owned without the subscription', ownsEntry(entry('pro-subscription'), { rank: 99, proActive: false }), false);
check('Pro is owned with it', ownsEntry(entry('pro-subscription'), { rank: 1, proActive: true }), true);

/*
 * Pro lifts the album cap and the reveal allowance. It does not hand over the cosmetics, and
 * that is a product decision rather than an oversight — the rank-gated items are the visible
 * record of having taken photographs, and selling them would empty that out.
 */
check(
  'Pro does not unlock a rank-gated cosmetic',
  ownsEntry(entry('frame-brass'), { rank: 1, proActive: true }),
  false
);

console.log('\n-- nothing purchasable can be owned yet --\n');

/*
 * The load-bearing one.
 *
 * There is no entitlements table in the schema. A cosmetic that is sold rather than earned has
 * nowhere for a purchase to be recorded, so `owned: false` is the truth right now — and it is
 * only the truth because `POST /shop/purchase` is unbuilt and the buy buttons are disabled.
 *
 * If this check ever fails, somebody has built purchasing. That is the moment cosmetics need
 * somewhere to live and `ownsEntry` needs to read it; see the note on that function.
 */
const richest = { rank: 999, proActive: true };

for (const e of CATALOG.filter((c) => c.requiredRank === 0 && c.kind !== 'pro')) {
  check(`'${e.id}' is not owned even at rank 999 with Pro`, ownsEntry(e, richest), false);
}

console.log('\n-- the whole response, for one player --\n');

const items = catalogFor({ rank: 7, proActive: false });

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
