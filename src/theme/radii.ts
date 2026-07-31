import { bezelPad } from './spacing';

/**
 * Corner radii.
 *
 * Radius varies by depth — tighter on inner elements, softer on containers. A single
 * uniform radius across every surface is a flagged weakness.
 */
export const radii = {
  /** Chips, ticks. */
  xs: 8,
  /** Badges, mono value pills. Rarity/rank badges are square-ish, not pills. */
  sm: 10,
  /** Secondary buttons, inputs. */
  md: 14,
  /** Inner core of a small bezel. */
  lg: 20,
  /** Outer shell of a card. */
  xl: 28,
  /** Modals, catch result card. */
  xxl: 36,
  /** Primary CTAs, floating tab bar, avatars. */
  full: 999,
} as const;

/**
 * Concentric inner radius.
 *
 * The inner core of a Double-Bezel must be `outerRadius - shellPadding`, or the two
 * curves visibly disagree along the corner. This is the only correct way to derive an
 * inner radius — never hardcode it.
 *
 *   concentric(radii.xl)      -> 22   (28 - 6)
 *   concentric(radii.xxl, 8)  -> 28   (36 - 8)
 */
export function concentric(outer: number, pad: number = bezelPad): number {
  if (outer >= radii.full) return radii.full;
  return Math.max(0, outer - pad);
}

/**
 * Avatars are squircles rather than perfect circles — circle-only avatars read as
 * generic. `circle` stays available for author chips sitting on a photo, where a round
 * crop is genuinely the right call.
 */
export const avatarRadius = {
  squircle: radii.xl,
  circle: radii.full,
} as const;
