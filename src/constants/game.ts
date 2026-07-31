import type { PoseClass, Rarity, Reaction } from '../models';

/**
 * ADVISORY mirror of server/src/game/rules.ts.
 *
 * These values exist so the UI can draw hints, meters and thresholds without a round
 * trip. They are never trusted for anything that matters: the client does not compute a
 * score, and the server re-derives every number it acts on. If the two ever disagree,
 * the server wins — update this file to match, not the other way round.
 */

export const RARITIES: readonly Rarity[] = ['Common', 'Rare', 'Epic', 'Legendary'];

export const REACTIONS: readonly Reaction[] = ['laugh', 'love', 'wow'];

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

/** Tier thresholds on the composite total. Used to preview the tier during the reveal. */
export const TIER_THRESHOLDS: { tier: Rarity; min: number }[] = [
  { tier: 'Legendary', min: 86 },
  { tier: 'Epic', min: 70 },
  { tier: 'Rare', min: 50 },
  { tier: 'Common', min: 0 },
];

export function tierFor(total: number): Rarity {
  return TIER_THRESHOLDS.find((t) => total >= t.min)?.tier ?? 'Common';
}

/**
 * Capture and framing window (README section 9.1).
 *
 * `windowMs` is the actual skill moment: once a cat has been stably detected the player
 * gets this long to wait for a better pose before the app shoots for them. The brief
 * calls for 3-5 seconds; 4 is the middle, and long enough that waiting feels like a
 * choice rather than a reflex.
 */
export const CAPTURE_CONFIG = {
  /** Frames a cat must stay in frame before the framing window opens. */
  stableDetectionFrames: 12,
  minDetectionConfidence: 0.6,
  windowMs: 4000,
  /** The window auto-captures at zero rather than losing the moment entirely. */
  autoCaptureAtEnd: true,
  /**
   * A detection has to drop out for this long before the window is cancelled. Without
   * the grace period a single bad frame — a blink, a head turn — resets the countdown.
   */
  detectionLostGraceMs: 700,
  maxPhotoEdge: 1280,
  /**
   * Pinned, not adaptive. The server's focus estimate reads compressed density, so a
   * client that varied quality per shot would vary its own composition score.
   */
  jpegQuality: 0.72,
} as const;

export const ALBUM_CONFIG = {
  freePhotoLimit: 200,
  upsellThreshold: 0.85,
  showcaseLimit: 6,
  /** Photos per album page request. */
  pageSize: 30,
} as const;

export const MAP_CONFIG = {
  sightingTtlHours: 72,
  defaultZoomDelta: 0.012,
  /** Debounce before refetching the viewport while the user is panning. */
  viewportDebounceMs: 400,
} as const;

export const FEED_CONFIG = {
  pageSize: 20,
  /**
   * Impressions are batched before reporting. One request per photo scrolled past would
   * be a request per ~200ms of scrolling.
   */
  impressionFlushMs: 2500,
} as const;

/**
 * The community scoring layer (mirrors server COMMUNITY).
 *
 * The app scores a photo instantly; the community scores it over time. Only the second
 * one drives rank — these values exist so the UI can say when a score is still
 * provisional and how many reactions the player has left today.
 */
export const COMMUNITY_CONFIG = {
  /** Below this many unique viewers, a community score is shown as provisional. */
  minViewsForConfidence: 10,
  maxVotesPerDay: 30,
  scoreScale: 1000,
} as const;

/** Community score as a percentage string, or null when it is not yet meaningful. */
export function communityLabel(
  communityScore: number,
  viewCount: number
): string | null {
  if (viewCount < COMMUNITY_CONFIG.minViewsForConfidence) return null;
  return `${Math.round((communityScore / COMMUNITY_CONFIG.scoreScale) * 100)}%`;
}

/**
 * Photographer Rank tiers. Cosmetic progression only — rank unlocks filters, frames and
 * themes, and has no effect on scoring (README section 1).
 */
export const RANK_TIERS: readonly { rank: number; title: string; xpRequired: number }[] = [
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

export function rankTitle(rank: number): string {
  return RANK_TIERS.find((t) => t.rank === rank)?.title ?? RANK_TIERS[0].title;
}

/** Progress through the current rank, 0-1. Drives the profile meter. */
export function rankProgress(xp: number, rank: number): number {
  const current = RANK_TIERS.find((t) => t.rank === rank) ?? RANK_TIERS[0];
  const next = RANK_TIERS.find((t) => t.rank === rank + 1);

  if (!next) return 1;

  const span = next.xpRequired - current.xpRequired;
  if (span <= 0) return 1;

  return Math.min(1, Math.max(0, (xp - current.xpRequired) / span));
}

/** Score-component labels for the breakdown report card. */
export const SCORE_LABELS = {
  composition: 'Composition',
  poseRarity: 'Pose rarity',
  catRarity: 'Cat rarity',
  bonus: 'Bonus',
} as const;

export const REACTION_LABELS: Record<Reaction, string> = {
  laugh: 'Funny',
  love: 'Love it',
  wow: 'Wow',
};
