/**
 * Shared domain types. These mirror the Node backend exactly (server/src/db/schema.prisma
 * and server/src/types.ts) — if you change one side, change the other.
 *
 * The interfaces in README section 7 are reproduced here field-for-field. Where the UI
 * needs something the brief did not list, it is added below the brief's fields and
 * commented with why, rather than quietly changing the documented shape.
 */

/** Photo quality tier, derived server-side from `scores.total`. Drives the card bezel. */
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';

export type Reaction = 'laugh' | 'love' | 'wow';

/**
 * Pose/action classes the scoring pipeline recognises (README 9.2, "pose rarity").
 * `unknown` exists so a low-confidence classification degrades instead of throwing.
 */
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

export interface GeoPoint {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ */
/* User                                                               */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  username: string;
  avatarUrl: string;
  photographerRank: number;
  photographerXp: number;
  createdAt: string;
  friendIds: string[];
  proSubscriptionActive: boolean;
}

/**
 * Own-account view. Album quota and lifetime totals are never exposed on another
 * player's profile, so they live here rather than on `User`.
 */
export interface Me extends User {
  email: string | null;
  /**
   * Cumulative instant score across every photo — the app's opinion of your work. Shown
   * for interest; it is deliberately NOT what rank is computed from.
   */
  lifetimeScore: number;
  /** Reactions received across every photo — the dominant term in Photographer Rank. */
  votesReceived: number;
  /** XP still needed to reach `photographerRank + 1`. Drives the profile meter. */
  xpToNextRank: number;
  photoCount: number;
  /** Free tier is capped; Pro is unlimited and reports `null`. */
  photoLimit: number | null;
  catsDiscovered: number;
}

/** Photographer Rank tiers — cosmetic progression only, never power (README section 1). */
export interface RankTier {
  rank: number;
  title: string;
  xpRequired: number;
}

/* ------------------------------------------------------------------ */
/* Photo — the core content object                                    */
/* ------------------------------------------------------------------ */

export interface PhotoScores {
  composition: number;
  poseRarity: number;
  catRarity: number;
  bonus: number;
  total: number;
}

export interface Photo {
  id: string;
  ownerId: string;
  imageUrl: string;
  caption?: string;
  /** Links to the recurring-cat record this photo is of. */
  catId: string;
  scores: PhotoScores;
  /** e.g. "Golden Hour", "Mid-Air Menace". */
  badges: string[];
  capturedAt: string;
  capturedLocation: GeoPoint;
  voteCount: number;
  submittedToChallengeId?: string;

  /* --- added for rendering; all derived server-side --- */

  /** Tier from `scores.total`. Colour-encoding a photo card needs one field, not a range. */
  tier: Rarity;
  /** Detected pose, shown as the pose-rarity row's label in the breakdown. */
  pose: PoseClass;
  /** Owner's nickname for the cat, denormalised so a grid does not N+1 on cats. */
  catNickname: string;
  /** Opt-in — a photo only reaches the Community Feed when the owner shared it. */
  sharedToFeed: boolean;
  /** Pinned to the owner's public-profile showcase. */
  showcased: boolean;

  /* --- the community layer --- */

  /**
   * Bayesian-smoothed engagement ratio, 0..1000. This is the community's verdict, and
   * it — not `scores.total` — is what drives Photographer Rank and the leaderboards.
   * The gap between the two is intentional: a photo the algorithm rates modestly but
   * players love is the "this blew up" moment.
   */
  communityScore: number;
  /** Unique viewers. Below `COMMUNITY_CONFIG.minViewsForConfidence` the score is provisional. */
  viewCount: number;
  /** Editorially boosted in the feed for cold start. */
  featured: boolean;
  /** Per-reaction tallies. `voteCount` is their sum, kept for the brief's shape. */
  reactions: Record<Reaction, number>;
  /** The signed-in player's reaction, when they have one. */
  myReaction: Reaction | null;

  /**
   * When the score was revealed, or null while it is still waiting for one.
   *
   * The one field that says whether `scores` means anything. Everything that draws a
   * number checks this first, because an unscored photo carries zeroes rather than
   * absent fields — see the serializer's note on why.
   */
  scoredAt: string | null;
  /** When the player confirmed which cat this is. Null until they do. */
  identifiedAt: string | null;
}

/** Feed and leaderboard rows carry their author inline to avoid a second request. */
export interface PhotoWithAuthor extends Photo {
  author: Pick<User, 'id' | 'username' | 'avatarUrl' | 'photographerRank'>;
}

/* ------------------------------------------------------------------ */
/* Cat Dex                                                            */
/* ------------------------------------------------------------------ */

export interface Cat {
  id: string;
  /** First person to photograph this recurring cat. */
  discoveredByUserId: string;
  nickname?: string;
  bio?: string;
  bestPhotoId: string;
  /**
   * True when the player chose the Dex photo by hand. While set, a higher-scoring shot of
   * the same cat no longer takes the tile.
   */
  bestPhotoPinned: boolean;
  encounterCount: number;
  firstSeenLocation: GeoPoint;
  lastSeenAt: string;

  /* --- added for rendering --- */

  /** Denormalised so a Cat Dex grid renders without fetching every best photo. */
  bestPhotoUrl: string;
  bestPhotoScore: number;
  /** Highest tier this player has achieved on this cat — drives the entry's bezel. */
  bestTier: Rarity;
  /** True when the signed-in player was the discoverer (shows the "Discovered by you" mark). */
  discoveredByMe: boolean;
  /** How many of this player's photos are of this cat. */
  photoCount: number;
}

/** Cat Profile screen: the cat plus this player's full encounter history. */
export interface CatProfile {
  cat: Cat;
  photos: Photo[];
  /** Distinct capture locations, for the mini map. */
  encounterLocations: GeoPoint[];
  firstEncounterAt: string;
}

/* ------------------------------------------------------------------ */
/* Challenges                                                         */
/* ------------------------------------------------------------------ */

/**
 * How a challenge picks its winner (README 9.4). Objective prompts rank by score;
 * subjective ones ("funniest") fall back to community votes.
 */
export type ChallengeJudging = 'score' | 'votes';

export type ChallengeStatus = 'upcoming' | 'active' | 'closed';

/**
 * Which glyph a challenge wears on the hub.
 *
 * A closed key rather than an icon name so the server never dictates a client asset: it
 * says what the challenge is *about*, and the client decides what that looks like. An
 * unrecognised key falls back to the trophy rather than rendering nothing.
 */
export type ChallengeIconKey =
  | 'rain'
  | 'sun'
  | 'night'
  | 'rarity'
  | 'community'
  | 'trophy';

/**
 * Progress toward a challenge's goal, for the player asking.
 *
 * `target` is what finishes it and `current` is where this player is. A community goal
 * reports the whole field's progress instead — same shape, and `unit` is what makes the
 * difference legible ("spotted" vs "hunters joined").
 */
export interface ChallengeProgress {
  current: number;
  target: number;
  /** Noun or verb completing "3 of 5 ___". Kept server-side so copy is not a deploy. */
  unit: string;
}

/**
 * A standing goal — the quiet list under the weekly challenge.
 *
 * Not a challenge: nothing is submitted to a goal and none of them closes on a date. They
 * are running counts over what the player has already done, which is why the hub draws
 * them as meters and gives them no tap target.
 */
export interface ChallengeGoal {
  id: string;
  title: string;
  description: string;
  icon: ChallengeIconKey;
  /** A community goal's meter is the whole neighbourhood's, not this player's. */
  kind: 'personal' | 'community';
  progress: ChallengeProgress;
}

/** Who is winning an in-flight challenge. Only meaningful while it is still open. */
export interface ChallengeLeader {
  user: Pick<User, 'id' | 'username' | 'avatarUrl'>;
  qualifyingShots: number;
  reactions: number;
}

export interface Challenge {
  id: string;
  title: string;
  prompt: string;
  startsAt: string;
  endsAt: string;
  winningPhotoId?: string;

  /* --- added for rendering --- */

  status: ChallengeStatus;
  judging: ChallengeJudging;
  submissionCount: number;
  /** This player's entry, when they have one — the hub shows "Entered" instead of a CTA. */
  mySubmissionPhotoId: string | null;
  /** Populated on closed challenges so the winners rail needs no extra fetch. */
  winningPhoto?: PhotoWithAuthor;

  /* --- optional, for the hub's richer surfaces --- */

  /**
   * Everything below is optional and every one of them renders only when the server sends
   * it. The hub degrades a row at a time rather than all at once: a challenge with no
   * `progress` still shows its title, countdown and reward, and a challenge with none of
   * these is exactly the card that shipped before.
   */

  /**
   * What winning pays, derived server-side from the XP rule that actually grants it.
   * There is no per-challenge badge — do not put one here without shipping one.
   */
  reward?: string | null;
  /** This player's progress, or the field's for a community goal. */
  progress?: ChallengeProgress | null;
  icon?: ChallengeIconKey | null;
}

/* ------------------------------------------------------------------ */
/* Map                                                                */
/* ------------------------------------------------------------------ */

export interface CatSighting {
  id: string;
  reportedByUserId: string;
  location: GeoPoint;
  photoUrl: string;
  verified: boolean;
  createdAt: string;

  /* --- the capture behind the pin, when there was one --- */

  /**
   * Score and tier of the photograph that logged this sighting.
   *
   * Null for a bare report with no capture behind it, and for a sighting whose photo has
   * since been deleted — the pin outlives its evidence, because the cat was there either
   * way. Each field degrades on its own.
   */
  score: number | null;
  tier: Rarity | null;
  /** Who reported it. Null only if the account is gone. */
  reporter: { username: string; avatarUrl: string } | null;
}

/* ------------------------------------------------------------------ */
/* Votes                                                              */
/* ------------------------------------------------------------------ */

export interface Vote {
  id: string;
  photoId: string;
  voterId: string;
  reaction: Reaction;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Capture flow                                                       */
/* ------------------------------------------------------------------ */

/*
 * `PhotoSubmission` is gone. The phone uploads to storage itself and the request carries a
 * path, so there is no base64 body left to describe — see photoApi.capture.
 */

export type SubmissionRejectionReason =
  | 'no-cat-detected'
  | 'spoofed-photo'
  | 'rate-limited'
  | 'location-required'
  | 'album-full'
  | 'vision-unavailable';

/**
 * How many scores a player has left in the rolling window.
 *
 * The shutter is never rationed; this is. `limit: null` means unlimited, which is what a
 * Pro account gets.
 */
export interface RevealAllowance {
  limit: number | null;
  used: number;
  remaining: number | null;
  /** When the next slot frees up. Null while there are slots left. */
  resetsAt: string | null;
}

/**
 * What comes back from a capture.
 *
 * `scored` is the field everything branches on. A capture beyond the allowance is stored
 * whole and returns `scored: false` with a photo whose `scoredAt` is null — the score is
 * revealed from the album later, and until then there is no number to show.
 *
 * The cat, the XP and the rank-up that used to ride along are gone until the systems that
 * produce them exist. Carrying them as zeroes would have put a "+0 XP" on the reveal screen
 * and a cat nobody identified.
 */
export interface ScoredCapture {
  photo: Photo;
  allowance: RevealAllowance;
  scored: boolean;
}

/* ------------------------------------------------------------------ */
/* Social                                                             */
/* ------------------------------------------------------------------ */

export type LeaderboardScope = 'neighborhood' | 'city' | 'global' | 'friends';

/**
 * `community` is the headline board — best smoothed engagement ratio. `topPhoto` is the
 * app's own opinion, kept as a secondary tab so the two can visibly disagree.
 */
export type LeaderboardMetric =
  | 'community'
  | 'votesReceived'
  | 'challengeWins'
  | 'topPhoto';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string;
  value: number;
  isSelf: boolean;
  /** Thumbnail of the photo that earned the rank. Null for the challenge-wins metric. */
  topPhotoUrl: string | null;
}

export interface PublicProfile {
  user: User;
  /** The photos this player chose to showcase, best-first. */
  showcasePhotos: Photo[];
  /**
   * Tier counts across their *shared* photos only.
   *
   * The photographs themselves are not here and never were sent: a stranger sees the shape
   * of an album, not its contents. `sharedToFeed` is the public/private line and it is the
   * player's own switch — counting the full album would leak how much they keep private,
   * which is exactly the number they decided not to share.
   */
  tierCounts: Record<Rarity, number>;
  /** Public photos, not the album total: how much is kept private is itself private. */
  totalPhotos: number;
  catsDiscovered: number;
  bestScore: number;
  challengeWins: number;
}

/* ------------------------------------------------------------------ */
/* Shop                                                               */
/* ------------------------------------------------------------------ */

/** README section 5.7: Camera Filters, Frame Styles, Gallery Themes, Pro. */
export type ShopItemKind = 'filter' | 'frame' | 'theme' | 'pro';

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  name: string;
  description: string;
  /** Store product identifier passed to StoreKit / Play Billing. */
  productId: string;
  priceLabel: string;
  owned: boolean;
  /** Cosmetics can gate on rank — cosmetic progression, never power. */
  requiredRank: number;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
  /** Field-level validation failures, when the server sent them. */
  details?: unknown;
}
