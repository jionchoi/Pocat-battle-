/**
 * The shop's catalogue, and the rule that decides what a player already has.
 *
 * In `game/` rather than in the service because none of it is a database question. The
 * catalogue is authored content and entitlement is arithmetic over two numbers the caller
 * passes in, so all of it can be exercised by `scripts/check-shop.ts` with no project and no
 * key — the split §7 describes, and the reason the matching weights have real tests.
 *
 * ## Two kinds of item, and the screen already knows the difference
 *
 * `ShopScreen.tsx` branches on `requiredRank` rather than on `kind`:
 *
 *   - `requiredRank > 0` is **earned**. The row shows the rank it takes, never a price,
 *     because offering to sell somebody something they are already earning is a dark pattern.
 *     Owned means "reached that rank", and rank is a number we have.
 *   - `requiredRank === 0` is **sold**. The row shows a price on a button that is disabled in
 *     this build, because `POST /shop/purchase` is deliberately unbuilt until receipts are
 *     validated against Apple and Google.
 *
 * That split is what makes this endpoint honest to ship today. Every `owned` it reports is
 * derived from something the database actually knows.
 */

export type ShopItemKind = 'filter' | 'frame' | 'theme' | 'pro';

/**
 * A catalogue row as authored, before it is told who is asking.
 *
 * `owned` is deliberately not here. It is the one field that depends on the reader, and
 * keeping it off the authored shape means a new item cannot be written with an ownership
 * baked into it.
 */
export interface CatalogEntry {
  id: string;
  kind: ShopItemKind;
  name: string;
  description: string;
  /**
   * The store's identifier, and **empty for anything not sold**.
   *
   * A rank-gated cosmetic has no product behind it in App Store Connect or the Play Console —
   * there is nothing to buy — and inventing an identifier for one would put a string in the
   * response that looks purchasable to the next person who reads it.
   */
  productId: string;
  /** Empty for anything not sold, for the same reason. The screen draws a rank badge instead. */
  priceLabel: string;
  /** Zero means "this is for sale". Anything higher means it is earned and cannot be bought. */
  requiredRank: number;
}

/** What the server knows about the person asking, and all it needs to know. */
export interface Entitlements {
  rank: number;
  proActive: boolean;
}

/**
 * The catalogue.
 *
 * Seeded with something to look at rather than left empty, on the same reasoning as the two
 * challenge rows in `2026-08-12_challenges.sql`: an endpoint that answers `[]` cannot be told
 * apart from one that is broken, and all four of the screen's tabs would draw the same empty
 * state whether or not any of this works.
 *
 * **The product ids are placeholders.** They have to match what is actually configured in App
 * Store Connect and the Play Console before `POST /shop/purchase` is built, and that endpoint
 * is where a mismatch would surface — as a receipt that validates against a product nobody
 * sold. Prices are labels rather than amounts because a real IAP shows the store's own
 * localised price; these are what the row says until the purchase path can ask the store.
 *
 * Every entry is cosmetic. Nothing here can affect a score, and the header on the screen says
 * so — that is a product promise, and the place it could quietly stop being true is this list.
 */
export const CATALOG: readonly CatalogEntry[] = [
  /* ------------------------------- filters -------------------------------- */
  {
    id: 'filter-natural',
    kind: 'filter',
    name: 'Natural',
    description: 'No processing at all. What the sensor saw.',
    productId: '',
    priceLabel: '',
    // Rank 1 is where everybody starts, so this reads as "Unlocked" on a new account rather
    // than as a locked row on a screen the player has just opened for the first time.
    requiredRank: 1,
  },
  {
    id: 'filter-golden-hour',
    kind: 'filter',
    name: 'Golden Hour',
    description: 'Warms the low light of a late afternoon without touching the shadows.',
    productId: '',
    priceLabel: '',
    requiredRank: 4,
  },
  {
    id: 'filter-monochrome',
    kind: 'filter',
    name: 'Monochrome',
    description: 'Black and white, weighted for fur rather than for skin.',
    productId: 'com.catframe.filter.monochrome',
    priceLabel: '$1.99',
    requiredRank: 0,
  },

  /* -------------------------------- frames -------------------------------- */
  {
    id: 'frame-hairline',
    kind: 'frame',
    name: 'Hairline',
    description: 'A single thin rule. The default, and hard to improve on.',
    productId: '',
    priceLabel: '',
    requiredRank: 1,
  },
  {
    id: 'frame-brass',
    kind: 'frame',
    name: 'Brass',
    description: 'A warm metal edge for the shots that earned one.',
    productId: '',
    priceLabel: '',
    requiredRank: 7,
  },
  {
    id: 'frame-instant',
    kind: 'frame',
    name: 'Instant',
    description: 'Deep white border with the weight at the bottom, for a caption.',
    productId: 'com.catframe.frame.instant',
    priceLabel: '$1.99',
    requiredRank: 0,
  },

  /* -------------------------------- themes -------------------------------- */
  {
    id: 'theme-paper',
    kind: 'theme',
    name: 'Paper',
    description: 'The album as it ships. Warm white, generous margins.',
    productId: '',
    priceLabel: '',
    requiredRank: 1,
  },
  {
    id: 'theme-midnight',
    kind: 'theme',
    name: 'Midnight',
    description: 'A dark grid that lets a bright photograph carry the page.',
    productId: 'com.catframe.theme.midnight',
    priceLabel: '$2.99',
    requiredRank: 0,
  },
  {
    id: 'theme-contact-sheet',
    kind: 'theme',
    name: 'Contact Sheet',
    description: 'Tight rows, no gaps, frame numbers down the side.',
    productId: '',
    priceLabel: '',
    requiredRank: 10,
  },

  /* --------------------------------- pro ---------------------------------- */
  {
    id: 'pro-subscription',
    kind: 'pro',
    name: 'Cat Frame Pro',
    description:
      'Unlimited album storage, unlimited reveals, and full-resolution exports. Renews until you cancel.',
    productId: 'com.catframe.pro.monthly',
    priceLabel: '$3.99 / month',
    /*
     * Zero, because Pro is sold rather than earned — but its ownership does not come from the
     * `requiredRank === 0` branch below. `pro_subscription_active` is a real column and
     * `ownsEntry` reads it, which is why this is the one purchasable row whose `owned` can be
     * true today.
     */
    requiredRank: 0,
  },
];

/**
 * Whether this player already has this item.
 *
 * Three branches, and the last one is the one to read carefully.
 *
 * Pro is a column, so it is simply looked up. A rank-gated cosmetic is unlocked by having
 * reached the rank, which is arithmetic over `player_stats.rank`. **A purchasable cosmetic is
 * always false**, and that is truthful *only because nothing can be bought yet*: there is no
 * entitlements table in the schema, and there does not need to be while `POST /shop/purchase`
 * is unbuilt and the screen's buy buttons are disabled.
 *
 * The day purchases exist, this line becomes a lie — a player who paid would be told they do
 * not own what they bought. Whoever builds that endpoint has to give cosmetics somewhere to
 * live and read it here, and this comment is the note saying so.
 */
export function ownsEntry(entry: CatalogEntry, who: Entitlements): boolean {
  if (entry.kind === 'pro') return who.proActive;
  if (entry.requiredRank > 0) return who.rank >= entry.requiredRank;

  return false;
}

/** The catalogue as one player sees it. */
export function catalogFor(who: Entitlements) {
  return CATALOG.map((entry) => ({ ...entry, owned: ownsEntry(entry, who) }));
}
