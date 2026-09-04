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

import { canAfford } from './paws.js';

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
  /**
   * What this costs in paws, or `null` for "not sold for paws".
   *
   * **`null` is the default and the safe value.** An item is only paw-purchasable because
   * somebody put a number here, which is the whole design: adding a filter to the catalogue
   * must not accidentally make it buyable, and deciding that it *is* buyable should be a
   * one-line edit on the row rather than a change anywhere else.
   *
   * ## It is independent of `priceLabel` and of `requiredRank`
   *
   * Three separate questions, deliberately not collapsed into one enum:
   *
   *   - `requiredRank > 0` — earned by playing. Never sold, for either currency.
   *   - `priceLabel` — sold for money, through the store.
   *   - `pawPrice` — sold for paws, through `POST /shop/unlock`.
   *
   * An item may legitimately carry both prices: `unlockRefusal` below refuses a paw purchase
   * of anything rank-gated, and refuses nothing else, so money and paws are two doors to the
   * same item rather than two kinds of item.
   */
  pawPrice: number | null;
}

/** What the server knows about the person asking, and all it needs to know. */
export interface Entitlements {
  rank: number;
  proActive: boolean;
  /**
   * Catalogue ids this player has actually bought, from the `entitlements` table.
   *
   * Only acquisitions. A rank unlock is not in here and must never be written there — it is
   * arithmetic over `rank`, and a stored copy would go stale and, worse, would have to be
   * revoked if a rank ever fell. See the migration.
   */
  unlockedIds: readonly string[];
  /** The wallet, for deciding whether a paw price is affordable. Never the grant. */
  walletBalance: number;
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
    pawPrice: null,
  },
  {
    id: 'filter-golden-hour',
    kind: 'filter',
    name: 'Golden Hour',
    description: 'Warms the low light of a late afternoon without touching the shadows.',
    productId: '',
    priceLabel: '',
    requiredRank: 4,
    pawPrice: null,
  },
  {
    id: 'filter-monochrome',
    kind: 'filter',
    name: 'Monochrome',
    description: 'Black and white, weighted for fur rather than for skin.',
    productId: 'com.catframe.filter.monochrome',
    priceLabel: '$1.99',
    requiredRank: 0,
    /*
     * The one item priced in paws, and it is here to make the path real rather than because
     * forty is the right number.
     *
     * Everything else in this catalogue carries `pawPrice: null`, which is the deliberate
     * default — a filter is not paw-buyable until somebody decides it is. This row exists so
     * the unlock path can be exercised on a device instead of being a branch nothing reaches,
     * and Monochrome was chosen because it is already the one cosmetic sold rather than
     * earned: it needs no new decision about whether selling it is right, only about the price.
     *
     * Forty is roughly six weeks of a fully-given, fully-reciprocated grant. That is a guess.
     * Change it, or set it back to `null` and price a different one — both are this line.
     */
    pawPrice: 40,
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
    pawPrice: null,
  },
  {
    id: 'frame-brass',
    kind: 'frame',
    name: 'Brass',
    description: 'A warm metal edge for the shots that earned one.',
    productId: '',
    priceLabel: '',
    requiredRank: 7,
    pawPrice: null,
  },
  {
    id: 'frame-instant',
    kind: 'frame',
    name: 'Instant',
    description: 'Deep white border with the weight at the bottom, for a caption.',
    productId: 'com.catframe.frame.instant',
    priceLabel: '$1.99',
    requiredRank: 0,
    pawPrice: null,
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
    pawPrice: null,
  },
  {
    id: 'theme-midnight',
    kind: 'theme',
    name: 'Midnight',
    description: 'A dark grid that lets a bright photograph carry the page.',
    productId: 'com.catframe.theme.midnight',
    priceLabel: '$2.99',
    requiredRank: 0,
    pawPrice: null,
  },
  {
    id: 'theme-contact-sheet',
    kind: 'theme',
    name: 'Contact Sheet',
    description: 'Tight rows, no gaps, frame numbers down the side.',
    productId: '',
    priceLabel: '',
    requiredRank: 10,
    pawPrice: null,
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
    pawPrice: null,
  },
];

/**
 * Whether this player already has this item.
 *
 * Three ways to own something, and they are three different kinds of fact:
 *
 *   - **Pro** is a column on the profile, so it is looked up.
 *   - **A rank-gated cosmetic** is unlocked by having reached the rank, which is arithmetic
 *     over `player_stats.rank` and is deliberately *not* stored anywhere. A stored copy would
 *     go stale, and would have to be revoked if a rank ever fell.
 *   - **A bought cosmetic** is a row in `entitlements`, passed in as `unlockedIds`.
 *
 * The third branch used to be `return false`, with a comment saying that was truthful only
 * while nothing could be bought and that whoever built purchasing had to give cosmetics
 * somewhere to live. The 2026-08-30 migration is that table, and this is that branch. Note
 * what did **not** change: `POST /shop/purchase` is still unbuilt, so the money door is still
 * shut. What opened is the paw door.
 */
export function ownsEntry(entry: CatalogEntry, who: Entitlements): boolean {
  if (entry.kind === 'pro') return who.proActive;
  if (entry.requiredRank > 0) return who.rank >= entry.requiredRank;

  return who.unlockedIds.includes(entry.id);
}

/**
 * Why a paw unlock cannot go ahead, or `null` when it can.
 *
 * Every refusal the endpoint can give, decided here so `scripts/check-shop.ts` can exercise
 * all four without a database — and so the order they are checked in is visible in one place.
 * The order matters: an item that is already owned should say so rather than complaining
 * about the price, and an item that is not for sale should say *that* rather than reporting
 * that the player cannot afford a price it does not have.
 *
 *   `unknown_item`      — no such catalogue id.
 *   `already_owned`     — including owned by rank, which is the case worth getting right: a
 *                         rank-gated item is never for sale, so this is checked before price.
 *   `not_for_paws`      — `pawPrice` is null. The default for everything.
 *   `insufficient_paws` — the wallet does not cover it. The grant is never consulted.
 */
export type UnlockRefusal =
  | 'unknown_item'
  | 'already_owned'
  | 'not_for_paws'
  | 'insufficient_paws';

export function unlockRefusal(
  entry: CatalogEntry | undefined,
  who: Entitlements
): UnlockRefusal | null {
  if (!entry) return 'unknown_item';
  if (ownsEntry(entry, who)) return 'already_owned';

  /*
   * Pro is refused here as a side effect of having no `pawPrice`, and that is load-bearing
   * rather than incidental. Pro lifts the album cap and the reveal allowance — it is the one
   * thing in this catalogue that is not cosmetic — so a paw price on it would make the
   * currency buy *power*, which is the sentence the whole product is built not to say.
   * Leaving `pro-subscription` at `pawPrice: null` is what enforces that, and it should stay
   * null however tempting a paw-priced Pro trial looks.
   */
  if (entry.pawPrice === null) return 'not_for_paws';
  if (!canAfford(who.walletBalance, entry.pawPrice)) return 'insufficient_paws';

  return null;
}

/** The catalogue as one player sees it. */
export function catalogFor(who: Entitlements) {
  return CATALOG.map((entry) => ({ ...entry, owned: ownsEntry(entry, who) }));
}

/** One authored row by id, for the unlock path. */
export function entryById(entryId: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === entryId);
}
