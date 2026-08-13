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

/**
 * Floor for Legendary. The server may hold the real bar higher than this — it rises with
 * what the field is scoring — so the tier this file computes is a preview only. The tier
 * the server sends with the photo is the one that counts.
 */
export const LEGENDARY_BASE_MIN = 90;

/** Tier thresholds on the composite total. Used to preview the tier during the reveal. */
export const TIER_THRESHOLDS: { tier: Rarity; min: number }[] = [
  { tier: 'Legendary', min: LEGENDARY_BASE_MIN },
  { tier: 'Epic', min: 70 },
  { tier: 'Rare', min: 50 },
  { tier: 'Common', min: 0 },
];

/**
 * The total has no upper bound — a score above 100 is expected, not a bug. Nothing here
 * may reintroduce a ceiling: no `Math.min(total, 100)`, no `total / 100` meter. The
 * reveal renders it as a numeral for exactly this reason.
 */
export function tierFor(total: number, legendaryMin: number = LEGENDARY_BASE_MIN): Rarity {
  if (total >= Math.max(LEGENDARY_BASE_MIN, legendaryMin)) return 'Legendary';

  return (
    TIER_THRESHOLDS.filter((t) => t.tier !== 'Legendary').find((t) => total >= t.min)
      ?.tier ?? 'Common'
  );
}

/**
 * Capture (README section 9.1).
 *
 * What is left is the two settings that describe the photograph itself. The framing window
 * lived here too — a stable-detection threshold, a four-second countdown, an auto-capture at
 * zero and a grace period so a blink did not reset it. All of it is gone with the on-device
 * detector that fed it: the shutter is manual, so there is no window to tune.
 */
export const CAPTURE_CONFIG = {
  /**
   * The width the capture is resampled to before it is stored, in pixels.
   *
   * Width, not the longer edge — a portrait shot ends up taller than this and a landscape
   * one does not, which is deliberate: cats are usually photographed upright and the
   * orientation people actually shoot should not be the one that loses detail.
   *
   * This was 1280, and a modern phone shoots around 4032 across, so a capture was arriving
   * at about a tenth of the pixels it was taken with. Nobody could see the coat texture the
   * app is asking them to photograph. 2048 is roughly two and a half times the linear
   * resolution and still around a megabyte and a half a shot.
   *
   * It is a real trade, not a free upgrade: it is the file that is uploaded on mobile data,
   * the file that is stored, and — until the scoring call downsamples on its own side — the
   * file the model is billed for. Lower it if uploads start to feel slow.
   */
  maxPhotoWidth: 2048,
  /**
   * Pinned, not adaptive. The server's focus estimate reads compressed density, so a
   * client that varied quality per shot would vary its own composition score.
   *
   * Raised from 0.72, which was visibly soft on flat areas — fur and whiskers are exactly
   * the fine, high-frequency detail that a low JPEG quality smears first, and they are what
   * the photograph is of.
   */
  jpegQuality: 0.85,
} as const;

export const ALBUM_CONFIG = {
  /**
   * Mirrored by `PHOTO_LIMITS.free` in the server's game/album.ts, which is the copy that
   * decides. This one draws the meter — and a meter drawn from a different number than the
   * one being enforced is worse than no meter, so the two move together.
   */
  freePhotoLimit: 200,
  /**
   * Where the storage warning appears — nine tenths full, the way a drive warns before it
   * is a problem rather than at the moment it becomes one.
   *
   * Late enough that it is news. A warning at half full is a advertisement wearing a
   * warning's clothes, and a player who learns to dismiss this one will dismiss the sheet
   * at 200 too, which is the one that actually needs reading.
   */
  upsellThreshold: 0.9,
  showcaseLimit: 6,
  /**
   * Photos per album page request.
   *
   * Twenty divides `freePhotoLimit` into exactly ten pages, so a free player's whole album
   * is a bounded scroll rather than an open-ended one. Mirrored by `ALBUM_PAGE_SIZE` in the
   * server's game/album.ts — this value is sent as `limit` on every request, so the two
   * disagreeing means the server's copy never applies.
   */
  pageSize: 20,
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
   *
   * Ten seconds rather than the original 2.5. This is the highest-frequency request every
   * client makes, so the interval is a direct multiplier on fleet-wide write volume: at a
   * hundred thousand concurrent readers it is the difference between ~40k and ~10k
   * requests per second arriving at the impression endpoint. Nothing in the product reads
   * a view count quickly enough to notice the delay, and the hook flushes on unmount so a
   * reader who scrolls and leaves still counts.
   */
  impressionFlushMs: 10_000,
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
