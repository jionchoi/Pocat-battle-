import type { ScoringResponse } from './scoring.js';

/**
 * How a photograph is matched to a cat.
 *
 * The rules, with no database in them — which is the point of the file. Everything here is a
 * pure function of things already known, so the ranking can be reasoned about, exercised and
 * argued with on its own, and `services/catMatching.ts` is left doing nothing but fetching
 * rows and assembling the answer.
 *
 * None of it decides anything. It produces an ordering; a player decides. A vision model
 * asked "is this the same cat" fails in both directions and the two failures are not equally
 * bad — a missed match makes a duplicate the player can merge, a false match folds two
 * animals into one Dex entry with nothing left to separate them. So the shortlist is allowed
 * to be wrong, and is never allowed to be final.
 */

/* -------------------------------------------------------------------------- */
/* Tunables                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which cats may appear on a shortlist.
 *
 *   'nearby'   — every cat last seen near the capture, whoever photographed it.
 *   'dex-only' — only cats this player has already met.
 *
 * Set to 'nearby', and the reasoning is worth keeping because the privacy question looks
 * worse than it is. A nearby shortlist does reveal that *some* cat exists near you, with its
 * name and what it looks like — but the map already publishes a coarsened pin for every
 * capture whose owner left `shared_to_map` on, and that is the default. The fact leaked here
 * is one the product already publishes, minus the pin, minus the photograph, minus the owner,
 * at the same coarseness.
 *
 * 'dex-only' costs more than it looks. Two players standing over the same cat could never
 * converge on one row, so `cats.discovered_by` would mean "first to photograph this player's
 * private copy" — which is to say nothing — and the shared `cats` table would be a per-player
 * table wearing a disguise.
 *
 * Flipping this is the whole change. Everything downstream reads the shortlist, not the scope.
 */
export const SHORTLIST_SCOPE: 'nearby' | 'dex-only' = 'nearby';

/**
 * How far from the capture to look, in metres.
 *
 * Cats are territorial and that is the entire reason location works as a signal — the animal
 * on this corner is very often the animal somebody photographed on this corner last week. A
 * few hundred metres covers a normal range without pulling in the next neighbourhood, which
 * costs nothing to exclude and is pure noise in the ranking.
 */
export const SEARCH_RADIUS_M = 300;

/**
 * How many nearby cats to rank before cutting to the shortlist.
 *
 * The pool is also what the trait weighting calibrates against — see `idfOver` — so it wants
 * to be a fair sample of the neighbourhood. Ordered by most recently seen, so a dense area
 * drops the cats nobody has photographed in a long time first.
 */
export const POOL_LIMIT = 200;

/** How many candidates reach the player. More than a handful is not a question, it is a list. */
export const MAX_CANDIDATES = 5;

/**
 * How much of the confidence is proximity and how much is the description.
 *
 * Location has already done its job by the time these apply: everything being ranked came out
 * of the bounding box, so it is all nearby, and distance is a tiebreaker among cats that
 * passed the same test rather than a second opinion competing with the description.
 *
 * These started at 0.35/0.65 and that was wrong in a way worth recording, because it looked
 * reasonable and was not. A brown tabby ten metres away scored the same as a brown tabby with
 * a notched left ear three hundred metres away, when the photograph described a notched left
 * ear — the two common traits the near cat did match were enough, at that weighting, to buy
 * back everything the decisive one cost it. A notch in an ear is the whole reason the trait
 * system exists; it must not be outrun by somebody standing closer.
 *
 * The lower proximity weight also gives the undescribed case an honest ceiling: a photograph
 * nobody has scored yet cannot rank above 0.2, because "a cat was near where you stood" is
 * weak evidence and should present as weak.
 */
export const PROXIMITY_WEIGHT = 0.2;
export const TRAIT_WEIGHT = 0.8;

/** Below this, two coordinates are "here" and the difference is GPS noise, not movement. */
export const NEARBY_M = 250;

/* -------------------------------------------------------------------------- */
/* Traits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What the game knows about how a cat looks.
 *
 * Derived from the scoring schema rather than restated, because `photos.traits` stores that
 * reply verbatim — so changing the model's trait vocabulary changes this type, and any
 * matching code that stopped lining up stops compiling.
 *
 * Partial because the column defaults to `{}`. An unscored photograph has never been
 * described, and one scored before a field existed never will be, so "not described" and
 * "described as null" both have to be ordinary here.
 */
export type TraitSet = Partial<ScoringResponse['traits']>;

/**
 * A description reduced to comparable tokens.
 *
 * Colours deliberately lose their slot. A model shown the same tuxedo cat twice will call it
 * black-with-white one day and white-with-black the next, and a comparison respecting primary
 * versus secondary would score that pair as a mismatch on *both* fields — turning the single
 * most recognisable thing about the animal into evidence against itself.
 */
export function tokensOf(traits: TraitSet | null | undefined): Set<string> {
  const tokens = new Set<string>();
  const t = traits ?? {};

  const add = (prefix: string, value: string | null | undefined) => {
    const word = value?.trim().toLowerCase().replace(/\s+/g, ' ');
    if (word) tokens.add(`${prefix}:${word}`);
  };

  add('coat', t.coatPattern);
  // Both colours under one prefix — see above.
  add('color', t.primaryColor);
  add('color', t.secondaryColor);
  add('eye', t.eyeColor);

  for (const mark of t.markings ?? []) add('mark', mark);

  return tokens;
}

/**
 * How much each trait is worth, measured against the neighbourhood rather than a list.
 *
 * "Rare traits weigh more than common ones" needs a definition of rare, and the tempting one
 * is a hand-maintained table of common words. That table is wrong the moment it meets a
 * street where every cat is a tabby — which is what streets are like, because cats are
 * related to their neighbours.
 *
 * So rarity is computed from the pool being ranked: a trait shared by two of forty nearby
 * cats tells them apart, one shared by thirty does not, whatever the word is. It calibrates
 * itself per neighbourhood, needs no vocabulary to maintain, and is the standard
 * inverse-document-frequency shape.
 */
export function idfOver(pool: readonly Set<string>[]): Map<string, number> {
  const seen = new Map<string, number>();

  for (const tokens of pool) {
    for (const token of tokens) seen.set(token, (seen.get(token) ?? 0) + 1);
  }

  const idf = new Map<string, number>();

  for (const [token, count] of seen) {
    idf.set(token, Math.log(1 + pool.length / (1 + count)));
  }

  return idf;
}

/**
 * The weight of a token, including one the pool has never seen.
 *
 * An unseen trait scores highest of all, which is right in both places it lands: it can never
 * be matched by anybody, and it enlarges the photograph's own denominator — so a genuinely
 * distinctive marking that no candidate shares drags every candidate down, which is exactly
 * what a distinctive marking should do.
 */
export function weightOf(token: string, idf: Map<string, number>, poolSize: number): number {
  return idf.get(token) ?? Math.log(1 + poolSize);
}

/**
 * How well a candidate matches the description, 0..1.
 *
 * Null when the photograph carries no traits — which is different from zero. Zero means
 * "described, and this cat is not it"; null means "never described", and the caller then
 * ranks on location alone rather than treating an absent description as a failed one.
 *
 * The denominator is what the photo claims, not what the cat has. A cat with fifteen recorded
 * markings must not out-rank a better match by having more chances to hit.
 */
export function agreementBetween(
  wanted: Set<string>,
  has: Set<string>,
  idf: Map<string, number>,
  poolSize: number
): number | null {
  if (wanted.size === 0) return null;

  let matched = 0;
  let total = 0;

  for (const token of wanted) {
    const weight = weightOf(token, idf, poolSize);
    total += weight;
    if (has.has(token)) matched += weight;
  }

  return total === 0 ? null : matched / total;
}

/** The matched traits themselves, heaviest first — they are what the sheet quotes back. */
export function matchedTraits(
  wanted: Set<string>,
  has: Set<string>,
  idf: Map<string, number>,
  poolSize: number
): string[] {
  return [...wanted]
    .filter((token) => has.has(token))
    .sort((a, b) => weightOf(b, idf, poolSize) - weightOf(a, idf, poolSize))
    .map((token) => token.slice(token.indexOf(':') + 1));
}

/* -------------------------------------------------------------------------- */
/* Distance, and the confidence built from it                                 */
/* -------------------------------------------------------------------------- */

/**
 * Metres between two coordinates, flat-earth.
 *
 * Equirectangular rather than haversine: over a few hundred metres the two disagree by
 * centimetres, and this is ordering a list of five.
 */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dy = (lat2 - lat1) * 110_574;
  const dx = (lng2 - lng1) * 111_320 * Math.cos(midLat);

  return Math.hypot(dx, dy);
}

/** 1 at the capture, 0 at the edge of the search radius and beyond it. */
export function proximityOf(metres: number): number {
  return Math.max(0, 1 - metres / SEARCH_RADIUS_M);
}

/**
 * The number the shortlist is ordered by.
 *
 * A photograph nobody has described yet is ranked on proximity alone, and the arithmetic says
 * so without a special case: with no trait term to add, the best any candidate can reach is
 * PROXIMITY_WEIGHT. That is the honest ceiling for "a cat was near where you were standing",
 * and it matters because identifying deliberately does not wait for a score — an unscored
 * photo is the ordinary state of anything taken past the day's allowance.
 */
export function confidenceOf(proximity: number, agreement: number | null): number {
  const raw =
    agreement === null
      ? PROXIMITY_WEIGHT * proximity
      : PROXIMITY_WEIGHT * proximity + TRAIT_WEIGHT * agreement;

  // Two decimals. It orders a list and marks a best guess; more digits would suggest a
  // precision the inputs do not have.
  return Math.round(raw * 100) / 100;
}

/**
 * Why this cat is on the list, in words.
 *
 * Written server-side for two reasons. The wording stops being a deploy, and — the one that
 * actually matters — precision gets decided next to the data.
 *
 * No phrase ever carries a number. `cats.last_seen_lat/lng` is bumped by whoever photographed
 * the animal last, which is very often not the person reading this, so a distance computed
 * from it is a distance to *somebody else's* capture. "42m away" would be a stranger's
 * position rendered as a helpful detail, and it would say it about a cat in the player's own
 * Dex just as readily.
 */
export function reasonsFor(metres: number, matched: readonly string[]): string[] {
  // Two traits at most. The list is a prompt to recognise an animal, not a description of one.
  return [
    metres <= NEARBY_M ? 'seen nearby' : 'seen a few streets away',
    ...matched.slice(0, 2),
  ];
}
