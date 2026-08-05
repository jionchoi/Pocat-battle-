/**
 * AUTHORITATIVE scoring rules. This file is the source of truth for every number that can
 * affect a score.
 *
 * `src/constants/game.ts` in the mobile app mirrors the subset the UI needs to draw hints
 * and meters. That copy is advisory only — the client's numbers are never trusted, and
 * every score is derived here. If you change a value here, update the mirror; if the two
 * ever disagree, this file wins.
 *
 * Resolves the README open item "exact scoring formula weights".
 */

export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';

export type PoseClass =
  | 'sitting'
  | 'standing'
  | 'walking'
  | 'sleeping'
  | 'grooming'
  | 'stretching'
  | 'yawning'
  | 'jumping'
  | 'pouncing'
  | 'loafing'
  | 'unknown';

export const RARITIES: readonly Rarity[] = ['Common', 'Rare', 'Epic', 'Legendary'];

export const POSE_CLASSES: readonly PoseClass[] = [
  'sitting',
  'standing',
  'walking',
  'sleeping',
  'grooming',
  'stretching',
  'yawning',
  'jumping',
  'pouncing',
  'loafing',
  'unknown',
];

/* -------------------------------------------------------------------------- */
/* Composition (README 9.2)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Composition is three independent signals blended. Framing carries the most weight
 * because it is the one the player actually controls in the framing window — focus and
 * lighting are largely the phone's and the sun's doing, and punishing a player for dusk
 * would fight the "funny shot at any hour" goal.
 */
export const COMPOSITION_WEIGHTS = {
  framing: 0.5,
  focus: 0.3,
  lighting: 0.2,
} as const;

/**
 * Ideal fraction of the frame the cat should occupy. Below `min` the cat is a speck;
 * above `max` it is cropped. The score ramps linearly to the edges of the tolerated band
 * rather than falling off a cliff, so a near-miss is a near-miss and not a zero.
 */
export const FRAMING = {
  idealSubjectArea: 0.32,
  toleratedMin: 0.04,
  toleratedMax: 0.92,
  /**
   * Distance from a rule-of-thirds intersection (in normalised frame units) at which the
   * placement component reaches zero. Dead-centre is not penalised — it scores well, just
   * below a thirds placement.
   */
  thirdsFalloff: 0.34,
  /** Split of the framing sub-score between "right size" and "well placed". */
  areaWeight: 0.62,
  placementWeight: 0.38,
} as const;

/**
 * Focus is estimated from JPEG compressed density (bytes per pixel): blur removes
 * high-frequency detail, which is exactly what JPEG spends bits on. This is a proxy, not
 * a Laplacian variance — it needs no image decode, which keeps the submit path fast and
 * dependency-free. It is good enough to separate "clearly blurry" from "sharp"; it is not
 * good enough to rank two sharp photos, which is why focus is only 30% of composition.
 */
export const FOCUS = {
  /** Bytes per pixel at or below which an image reads as blurred/flat. */
  blurryBpp: 0.06,
  /** Bytes per pixel at or above which an image reads as fully sharp. */
  sharpBpp: 0.42,
  /** Used when dimensions could not be parsed — neutral, never a penalty. */
  unknownScore: 62,
} as const;

/**
 * Lighting from Vision's IMAGE_PROPERTIES dominant colours. Both crushed shadows and
 * blown highlights score low; the target is a well-exposed mid.
 */
export const LIGHTING = {
  idealLuminance: 0.54,
  /** Luminance distance from ideal at which the exposure component reaches zero. */
  falloff: 0.46,
  /** Colourfulness (dominant-colour saturation spread) adds a little on top. */
  saturationBonusMax: 12,
  unknownScore: 60,
} as const;

/* -------------------------------------------------------------------------- */
/* Pose rarity (README 9.2)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Base pose-rarity score per detected class. Common resting poses sit low; action and
 * expression moments score high. These are the numbers that make waiting through the
 * framing window worth it instead of snapping instantly.
 */
export const POSE_RARITY: Record<PoseClass, number> = {
  standing: 20,
  sitting: 24,
  loafing: 38,
  walking: 40,
  sleeping: 52,
  grooming: 62,
  stretching: 71,
  yawning: 84,
  pouncing: 92,
  jumping: 96,
  /** An unrecognised pose must not be punished as if it were boring. */
  unknown: 34,
};

/**
 * Classifier confidence scales the pose score toward the `unknown` baseline rather than
 * toward zero — a confidently-detected yawn beats a maybe-yawn, but a maybe-yawn still
 * beats a confident sit.
 */
export const POSE_CONFIDENCE_FLOOR = 0.45;

/* -------------------------------------------------------------------------- */
/* Cat rarity (README 9.2)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Coat/breed scarcity. Values are rough real-world frequency, not a fantasy tier list —
 * a tabby is genuinely everywhere and a calico male genuinely is not.
 */
export const COAT_RARITY: Record<string, number> = {
  tabby: 18,
  'domestic short-haired cat': 20,
  black: 26,
  white: 30,
  tuxedo: 38,
  ginger: 40,
  orange: 40,
  grey: 34,
  gray: 34,
  tortoiseshell: 58,
  calico: 62,
  'russian blue': 66,
  siamese: 68,
  bengal: 74,
  ragdoll: 76,
  'maine coon': 78,
  persian: 78,
  sphynx: 88,
  'scottish fold': 86,
  'norwegian forest cat': 84,
  abyssinian: 82,
  burmese: 76,
  birman: 80,
  manx: 84,
  savannah: 92,
};

export const CAT_RARITY = {
  /** Score for a cat whose coat matched nothing in the table. */
  unknownCoat: 32,
  /** Added when nobody anywhere has photographed this cat before. */
  firstDiscoveryBonus: 22,
  /**
   * Subtracted per prior global encounter, capped. A neighbourhood celebrity everyone has
   * shot is worth less than a cat nobody has seen, but never worthless.
   */
  familiarityPenaltyPer: 1.5,
  maxFamiliarityPenalty: 18,
} as const;

/* -------------------------------------------------------------------------- */
/* Bonus modifiers (README 9.2)                                               */
/* -------------------------------------------------------------------------- */

export const BONUS = {
  goldenHour: 6,
  blueHour: 4,
  multipleCats: 5,
  /** Per additional cat beyond the second, up to `multipleCatsMax` total. */
  perExtraCat: 2,
  multipleCatsMax: 11,
  /** Cat photographed somewhere structurally odd — on a roof, in a box, in a sink. */
  unusualLocation: 5,
  /** Cap on the summed bonus so modifiers can never dominate the real score. */
  max: 20,
} as const;

/** Vision labels that indicate a cat has put itself somewhere ridiculous. */
export const UNUSUAL_LOCATION_LABELS = [
  'box',
  'cardboard',
  'sink',
  'bathtub',
  'roof',
  'shelf',
  'bicycle',
  'car',
  'suitcase',
  'basket',
  'bag',
  'windowsill',
  'fence',
  'tree',
  'ladder',
  'shopping cart',
];

/** Local-hour ranges for the light bonuses. */
export const LIGHT_WINDOWS = {
  goldenHourMorning: [6, 8] as const,
  goldenHourEvening: [17, 19] as const,
  blueHourMorning: [5, 6] as const,
  blueHourEvening: [19, 21] as const,
};

/* -------------------------------------------------------------------------- */
/* Composite total                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Total is NOT a linear sum (README 9.2 is explicit about this).
 *
 * A weighted mean alone punishes a lopsided photo: the blurry shot of a cat mid-jump —
 * exactly the shot this app exists to celebrate — would average out to mediocre. So the
 * total blends the weighted mean with the single best component. A photo that is
 * outstanding at one thing keeps most of that, while a photo that is mediocre at
 * everything gets no lift.
 *
 *   total = (1 - PEAK_PULL) * weightedMean + PEAK_PULL * bestComponent + bonus
 *
 * Pose carries the heaviest weight because timing is the actual skill being tested.
 */
export const SCORE_WEIGHTS = {
  composition: 0.34,
  poseRarity: 0.38,
  catRarity: 0.28,
} as const;

export const PEAK_PULL = 0.28;

/** Tier thresholds on the composite total. Drives the card bezel and album filters. */
export const TIER_THRESHOLDS: { tier: Rarity; min: number }[] = [
  { tier: 'Legendary', min: 86 },
  { tier: 'Epic', min: 70 },
  { tier: 'Rare', min: 50 },
  { tier: 'Common', min: 0 },
];

export function tierFor(total: number): Rarity {
  return TIER_THRESHOLDS.find((t) => total >= t.min)?.tier ?? 'Common';
}

export interface ScoreComponents {
  composition: number;
  poseRarity: number;
  catRarity: number;
  bonus: number;
}

export function compositeTotal(parts: ScoreComponents): number {
  const mean =
    parts.composition * SCORE_WEIGHTS.composition +
    parts.poseRarity * SCORE_WEIGHTS.poseRarity +
    parts.catRarity * SCORE_WEIGHTS.catRarity;

  const peak = Math.max(parts.composition, parts.poseRarity, parts.catRarity);

  const blended = (1 - PEAK_PULL) * mean + PEAK_PULL * peak;

  return clamp(Math.round(blended + parts.bonus), 0, 100);
}

/* -------------------------------------------------------------------------- */
/* Badges & titles (README 5.2, 9.2)                                          */
/* -------------------------------------------------------------------------- */

export interface BadgeContext extends ScoreComponents {
  total: number;
  pose: PoseClass;
  isNewCat: boolean;
  encounterCount: number;
  goldenHour: boolean;
  catCount: number;
  unusualLocation: boolean;
}

/**
 * Badge rules, evaluated in order. `max` caps how many a single photo can wear — three
 * is the most a card can show without the badges crowding out the photo itself.
 *
 * "Blurry but Worth It" is the rule the README calls out by name: it exists so a
 * high-pose/low-composition shot reads as a prize rather than as a failure.
 */
export const BADGE_RULES: { id: string; label: string; when: (c: BadgeContext) => boolean }[] = [
  {
    id: 'blurry-but-worth-it',
    label: 'Blurry but Worth It',
    when: (c) => c.poseRarity >= 70 && c.composition < 45,
  },
  {
    id: 'mid-air-menace',
    label: 'Mid-Air Menace',
    when: (c) => c.pose === 'jumping' || c.pose === 'pouncing',
  },
  { id: 'caught-mid-yawn', label: 'Caught Mid-Yawn', when: (c) => c.pose === 'yawning' },
  { id: 'full-stretch', label: 'Full Stretch', when: (c) => c.pose === 'stretching' },
  { id: 'perfect-loaf', label: 'Perfect Loaf', when: (c) => c.pose === 'loafing' },
  { id: 'utterly-unbothered', label: 'Utterly Unbothered', when: (c) => c.pose === 'sleeping' },
  { id: 'golden-hour', label: 'Golden Hour', when: (c) => c.goldenHour },
  { id: 'somewhere-odd', label: 'Somewhere Odd', when: (c) => c.unusualLocation },
  { id: 'full-house', label: 'Full House', when: (c) => c.catCount >= 2 },
  { id: 'new-face', label: 'New Face', when: (c) => c.isNewCat },
  { id: 'old-friend', label: 'Old Friend', when: (c) => c.encounterCount >= 10 },
  { id: 'rare-coat', label: 'Rare Coat', when: (c) => c.catRarity >= 75 },
  { id: 'textbook-framing', label: 'Textbook Framing', when: (c) => c.composition >= 85 },
  { id: 'near-perfect', label: 'Near Perfect', when: (c) => c.total >= 94 },
];

export const BADGE_LIMIT = 3;

/* -------------------------------------------------------------------------- */
/* Community score — the second scoring layer                                 */
/* -------------------------------------------------------------------------- */

/**
 * The app scores a photo instantly (everything above). The community scores it over
 * time (everything here). They are deliberately different numbers, and the gap between
 * them is the point: a shot the algorithm rates modestly but players love is exactly the
 * "this blew up" moment worth sharing.
 *
 * `total` is the app's opinion and drives the tier badge. `communityScore` is the
 * community's opinion and drives Photographer Rank, the leaderboards and vote-judged
 * challenges.
 *
 * ## Why this is not simply votes ÷ views
 *
 * A raw ratio is unusable at small samples: a photo seen once and voted once scores
 * 1.000 and outranks a photo with 900 votes from 1,000 views. Every leaderboard would be
 * topped by photos nobody has seen.
 *
 * The fix is a Bayesian average — treat every photo as starting with `smoothingViews`
 * imaginary views at the global average vote rate, and let real data pull it away from
 * that prior:
 *
 *     score = (votes + C · priorRate) / (views + C)
 *
 * A 1-view/1-vote photo lands just above the prior. A 1,000-view/900-vote photo lands
 * near 0.9. Ordering is correct at both ends, and this preserves the property that
 * matters: a great photo from a small account still beats a mediocre one from a popular
 * account, because reach is in the denominator.
 *
 * It also solves cold start for free — a brand-new photo sits at the prior rather than
 * at zero, so it is not buried before anyone has had the chance to vote on it.
 */
export const COMMUNITY = {
  /**
   * Pseudo-count `C`. Roughly "how many views of evidence before the photo's own data
   * outweighs the prior". Higher is more conservative and harder to game with a handful
   * of friends; lower lets genuinely good photos climb faster.
   */
  smoothingViews: 20,

  /**
   * Prior vote rate. The share of viewers expected to react to a typical photo. Start
   * conservative; once there is real traffic this should be recomputed from the actual
   * global mean rather than left as a guess.
   */
  priorVoteRate: 0.12,

  /**
   * Below this many unique viewers a photo is ranked but flagged provisional in the UI.
   * It has a score, it just has not been seen enough for that score to mean much.
   */
  minViewsForConfidence: 10,

  /**
   * Votes one player may cast per day.
   *
   * This is the anti-brigading control. Reciprocity rings and vote-trading both need
   * volume; a daily ceiling makes coordinated voting expensive without affecting anyone
   * scrolling the feed normally.
   */
  maxVotesPerDay: 30,

  /** Community score is stored as an integer to keep it indexable. */
  scoreScale: 1000,

  /** How long an editorially featured photo keeps its feed placement. */
  featuredBoostDays: 3,
} as const;

/**
 * Bayesian-smoothed engagement ratio, scaled to an integer 0..1000.
 *
 * Both inputs are unique-counted: one vote per player per photo, one view per player per
 * photo. Without that the ratio would be forgeable by re-scrolling.
 */
export function communityScore(params: { votes: number; views: number }): number {
  const votes = Math.max(0, params.votes);
  // Views cannot be below votes — you can't react to a photo you never saw. Clamping
  // here keeps a lost impression write from producing a ratio above 1.
  const views = Math.max(votes, Math.max(0, params.views));

  const ratio =
    (votes + COMMUNITY.smoothingViews * COMMUNITY.priorVoteRate) /
    (views + COMMUNITY.smoothingViews);

  return Math.round(clamp(ratio, 0, 1) * COMMUNITY.scoreScale);
}

/** True once a photo has been seen enough for its community score to be meaningful. */
export function hasConfidentCommunityScore(views: number): boolean {
  return views >= COMMUNITY.minViewsForConfidence;
}

/* -------------------------------------------------------------------------- */
/* Viral ranking                                                              */
/* -------------------------------------------------------------------------- */

export const VIRAL = {
  /** A reaction is a deliberate act; a view is passive. One reaction ≈ twelve views. */
  reactionWeight: 3,
  viewWeight: 0.25,

  /**
   * Seconds of freshness that one order of magnitude of engagement is worth.
   *
   * 45,000s ≈ 12.5 hours: a photo with 10× the reactions of another outranks it until it
   * is half a day older. This single number is the entire feel of the feed — lower it and
   * the app becomes a firehose of whatever was posted in the last hour, raise it and
   * yesterday's hits refuse to leave the rail.
   */
  decaySeconds: 45_000,

  /**
   * Quality shading, applied inside the log. Bounded 0.5–1.0 so a photo that got its
   * numbers from raw exposure is halved, but quality can never outrank magnitude — this
   * ranks *viral*, not *best*. `communityScore` already has reach in its denominator.
   */
  qualityFloor: 0.5,
  qualityRange: 0.5,
} as const;

/**
 * Viral score. **Time-invariant** — this is the load-bearing property of the whole feed.
 *
 *     hotScore = log10(max(E, 1)) + capturedAtSeconds / 45000
 *     where E = (3·reactions + 0.25·views) · quality
 *
 * ## Why it is written this way
 *
 * The obvious formulation is gravity — engagement divided by `(age + 2)^1.6`, the way
 * Hacker News does it. It produces good rankings and it is unusable at scale, because
 * `age` means the score of every row changes every second. A score containing the current
 * time cannot be stored in an index, cannot be cached for even a second, and cannot be
 * precomputed by a job. Every request has to sort the entire candidate set. That is fine
 * at a thousand photos and catastrophic at ten million.
 *
 * Log-space decay gives the same *ordering* with none of that cost. Compare two photos
 * under continuous exponential decay:
 *
 *     Eᵢ·e^(−λ(t−tᵢ)) > Eⱼ·e^(−λ(t−tⱼ))
 *     ⟺ ln Eᵢ − λt + λtᵢ > ln Eⱼ − λt + λtⱼ
 *     ⟺ ln Eᵢ + λtᵢ     > ln Eⱼ + λtⱼ
 *
 * The current time cancels. The comparison is the same at every instant, so the score is
 * a constant that only moves when engagement moves — which makes it a B-tree key, a Redis
 * ZSET score, and a cacheable ordering, all at once. Old photos still sink; nothing has to
 * be rescored for that to happen. (This is the shape Reddit's "hot" ranking uses, for the
 * same reason.)
 *
 * `log10` also does real product work: it compresses the head. Without it the photo with
 * 40,000 reactions sits on top of the rail for a week and no new photo can ever displace
 * it. In log space, beating it costs one more order of magnitude — or half a day of being
 * newer.
 */
export function hotScore(params: {
  reactions: number;
  views: number;
  communityScore: number;
  capturedAt: Date;
}): number {
  const quality =
    VIRAL.qualityFloor +
    (VIRAL.qualityRange * clamp(params.communityScore, 0, COMMUNITY.scoreScale)) /
      COMMUNITY.scoreScale;

  const engagement =
    (VIRAL.reactionWeight * Math.max(0, params.reactions) +
      VIRAL.viewWeight * Math.max(0, params.views)) *
    quality;

  // `max(E, 1)` keeps log10 defined and pins every zero-engagement photo to the same
  // baseline, so among photos nobody has touched yet the ordering is purely chronological.
  const magnitude = Math.log10(Math.max(engagement, 1));
  const age = params.capturedAt.getTime() / 1000 / VIRAL.decaySeconds;

  // Six decimal places is far finer than any real ranking gap and keeps the float stable
  // across the Postgres/Redis round trip, where a full-precision double would otherwise
  // reformat and cause spurious ZADD writes.
  return Math.round((magnitude + age) * 1e6) / 1e6;
}

/* -------------------------------------------------------------------------- */
/* Photographer Rank (README 1: cosmetic progression, never power)            */
/* -------------------------------------------------------------------------- */

export interface RankTier {
  rank: number;
  title: string;
  xpRequired: number;
}

export const RANK_TIERS: readonly RankTier[] = [
  { rank: 1, title: 'Newcomer', xpRequired: 0 },
  { rank: 2, title: 'Stray Spotter', xpRequired: 250 },
  { rank: 3, title: 'Alley Regular', xpRequired: 700 },
  { rank: 4, title: 'Fence Sitter', xpRequired: 1_500 },
  { rank: 5, title: 'Window Watcher', xpRequired: 2_800 },
  { rank: 6, title: 'Sunbeam Tracker', xpRequired: 4_800 },
  { rank: 7, title: 'Rooftop Regular', xpRequired: 7_600 },
  { rank: 8, title: 'Night Prowler', xpRequired: 11_500 },
  { rank: 9, title: 'Whisker Whisperer', xpRequired: 16_800 },
  { rank: 10, title: 'Neighborhood Fixture', xpRequired: 23_800 },
  { rank: 11, title: 'Cat Cartographer', xpRequired: 33_000 },
  { rank: 12, title: 'Loaf Laureate', xpRequired: 45_000 },
];

export function rankForXp(xp: number): RankTier {
  let current = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (xp >= tier.xpRequired) current = tier;
    else break;
  }
  return current;
}

export function nextRankTier(rank: number): RankTier | null {
  return RANK_TIERS.find((t) => t.rank === rank + 1) ?? null;
}

export function rankTitle(rank: number): string {
  return RANK_TIERS.find((t) => t.rank === rank)?.title ?? RANK_TIERS[0].title;
}

/**
 * XP, split across the two scoring layers.
 *
 * Rank is driven **mostly by community reception**, not by the instant algorithmic
 * score. Capturing still pays — the loop has to reward you for going outside, and a
 * player who never shares must still progress — but a photo other people react to is
 * worth far more than a photo the algorithm happened to like.
 *
 * The concrete ratio: a strong capture is worth ~18 XP, while the reactions a
 * well-received photo collects are worth up to 120 on the day it lands. So the community
 * term dominates for anyone who shares, and the capture term keeps a private player
 * moving at roughly a fifth of the pace rather than stalling at rank 1 forever.
 */
export const XP = {
  /**
   * Fraction of the instant score paid out as XP at capture. Deliberately a quarter:
   * the instant score is the dopamine hit, not the ranking.
   */
  perPhotoScoreMultiplier: 0.25,
  newCatDiscovery: 40,
  challengeEntry: 40,
  challengeWin: 400,

  /**
   * Awarded to the photo's owner each time a different player reacts. This is the
   * dominant term in rank, which is why it is worth 6x what it was when rank was
   * algorithm-driven.
   */
  perReactionReceived: 12,

  /**
   * Ceiling per photo per day. Blunts a reciprocity ring hammering one photo, and caps
   * how fast a single viral shot can carry someone up the ranks.
   */
  maxReactionXpPerPhotoPerDay: 120,
} as const;

/* -------------------------------------------------------------------------- */
/* Capture, album, map and challenge config                                   */
/* -------------------------------------------------------------------------- */

export const CAPTURE_CONFIG = {
  /** Client-side detection confidence below which the framing window will not open. */
  minDetectionConfidence: 0.6,
  /** Vision API confidence required to accept a submission at all. */
  serverMinConfidence: 0.7,
  /** Submissions allowed per user per hour. Anti-farming. */
  submissionsPerHour: 60,
  /** Metres within which a photo is treated as being of the same real-world cat. */
  identityRadiusM: 60,
} as const;

export const ALBUM_CONFIG = {
  /** Free-tier album cap. Pro is unlimited (README section 1, monetization). */
  freePhotoLimit: 200,
  /** Fraction of the cap at which the Pro upsell modal is triggered (README 5.7). */
  upsellThreshold: 0.85,
  /** Photos a player may pin to their public profile showcase. */
  showcaseLimit: 6,
} as const;

export const MAP_CONFIG = {
  sightingTtlHours: 72,
  corroborationRadiusM: 60,
  corroborationWindowHours: 24,
  /** Hard cap on rows returned per viewport query, regardless of bbox size. */
  maxViewportResults: 200,
  /** Reject absurd bboxes that would scan a continent. */
  maxBboxDegrees: 1.5,
} as const;

export const CHALLENGE_CONFIG = {
  /** How long a weekly challenge runs. */
  durationDays: 7,
  /** One entry per player per challenge — resubmitting replaces the previous entry. */
  entriesPerPlayer: 1,
  /** Minimum entries before a winner is declared rather than the challenge voided. */
  minEntriesToJudge: 3,
} as const;

export const LEADERBOARD_CONFIG = {
  /** Rounding applied to home coordinates to form a neighborhood bucket (~1.1km). */
  neighborhoodPrecision: 2,
  topN: 100,
  /** Window the totalScore and challengeWins metrics aggregate over. */
  windowDays: 30,
} as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear ramp from 0 at `from` to 100 at `to`, clamped at both ends. */
export function ramp(value: number, from: number, to: number): number {
  if (to === from) return value >= to ? 100 : 0;
  return clamp(((value - from) / (to - from)) * 100, 0, 100);
}

/** Metres between two coordinates. Haversine — good to well under a metre at city scale. */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}
