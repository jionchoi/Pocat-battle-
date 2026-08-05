import { bezelPad } from './spacing';

/**
 * Corner radii.
 *
 * Radius varies by depth — tighter on inner elements, softer on containers. A single
 * uniform radius across every surface is a flagged weakness.
 *
 * The scale is tighter than it was: photographs now bleed to the card edge with no
 * bezel between them, and a 28px radius on a 148px poster eats a visible bite out of the
 * cat. Containers hold their curve; anything wrapping an image sits at 16–20.
 */
export const radii = {
  /** Icon wells, small glyph squares. */
  xs: 8,
  /** Badges, tier chips, mono value pills. */
  sm: 10,
  /** Secondary buttons, inputs. */
  md: 14,
  /** Collection tiles, showcase cells, wall cards. */
  lg: 18,
  /** Poster cards on the trending rail. */
  xl: 20,
  /** The sheet that overlaps a full-bleed hero; bottom sheets; modals. */
  xxl: 26,
  /** Primary CTAs, floating tab bar, avatars, the capture FAB. */
  full: 999,
} as const;

/**
 * Concentric inner radius.
 *
 * The inner core of a Double-Bezel must be `outerRadius - shellPadding`, or the two
 * curves visibly disagree along the corner. This is the only correct way to derive an
 * inner radius — never hardcode it.
 *
 *   concentric(radii.xl)      -> 14   (20 - 6)
 *   concentric(radii.xxl, 8)  -> 18   (26 - 8)
 */
export function concentric(outer: number, pad: number = bezelPad): number {
  if (outer >= radii.full) return radii.full;
  return Math.max(0, outer - pad);
}

/**
 * Avatars are circles here rather than squircles. Every avatar in this product sits
 * either on a photograph or beside one, and a squircle reads as a photo thumbnail at
 * small sizes — the round crop is what distinguishes "a person" from "a picture".
 * `squircle` stays available for the shop's frame previews.
 */
export const avatarRadius = {
  squircle: radii.lg,
  circle: radii.full,
} as const;
