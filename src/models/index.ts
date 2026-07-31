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

export interface PhotoSubmission {
  /** base64 JPEG, downscaled client-side before upload. */
  photoBase64: string;
  location: GeoPoint;
  /** Client-side detection confidence. Advisory only — Node re-verifies. */
  clientConfidence: number;
  /**
   * Milliseconds the player waited inside the framing window before shooting. Advisory
   * telemetry for tuning the window length; it does not feed the score, because a client
   * number that raised your score would be the first thing anyone forged.
   */
  framingHeldMs: number;
  /** True when the window expired and the app shot for them. */
  autoCaptured: boolean;
  logSighting: boolean;
  shareToFeed: boolean;
}

export type SubmissionRejectionReason =
  | 'no-cat-detected'
  | 'spoofed-photo'
  | 'rate-limited'
  | 'location-required'
  | 'album-full'
  | 'vision-unavailable';

export interface ScoredCapture {
  photo: Photo;
  cat: Cat;
  /** True when this capture created a new Cat Dex entry. */
  isNewCat: boolean;
  /** Editable suggestions for the caption field (README section 2, caption generator). */
  captionSuggestions: string[];
  xpAwarded: number;
  /** Present only when this capture pushed the player into a new Photographer Rank. */
  rankUp: { from: number; to: number; title: string } | null;
}

export type PhotoSubmissionResult =
  | ({ outcome: 'scored' } & ScoredCapture)
  | {
      outcome: 'rejected';
      reason: SubmissionRejectionReason;
      message: string;
    };

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
