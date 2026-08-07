/**
 * Spacing scale. VISUAL_DENSITY 4 — daily-app rhythm, with macro-whitespace on
 * reveal and marketing surfaces.
 *
 * RN has no CSS Grid. Equal columns come from `gap` + `flex: 1`; fractional spans come
 * from a single `flexBasis` computed once from window width. Never percentage math.
 */

export const spacing = {
  /** Hairline offsets and optical nudges only. */
  hair: 2,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  /** Double-Bezel inner core padding. */
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  /** Macro-whitespace: catch reveal, onboarding, empty states. */
  huge: 64,
} as const;

/** Padding of the outer shell in a Double-Bezel. Drives concentric radius math. */
export const bezelPad = 6;

export const layout = {
  /** Horizontal screen gutter. */
  gutter: spacing.md,
  /** Gap between sections in a scroll view. */
  sectionGap: spacing.xxl,
  /** Gap between a section heading and its content. */
  headingGap: spacing.sm,
  /** Collection grid gutter between cards. */
  gridGap: spacing.sm,
  /** Floating tab bar: inset from each side edge. */
  tabBarInset: spacing.md,
  /**
   * Floating tab bar: lift above the safe-area inset.
   *
   * Small but not zero. The bar is a detached pill, and a pill resting on the safe-area
   * line reads as a bar glued to the screen edge with its corners rounded — the thing the
   * floating treatment exists to avoid.
   */
  tabBarLift: spacing.hair,
  /** Height of the pill itself, shutter excluded. */
  tabBarHeight: 52,
  /**
   * Bottom padding added to scroll content so the floating bar never covers a row.
   * Clears the whole assembly, shutter included — the shutter breaks out of the pill's
   * top edge, so clearing only the pill would leave the last card half under a coral disc.
   */
  tabBarClearance: 116,
  /** Minimum touch target, including map pins. */
  minTouch: 44,
  /**
   * Breakpoint below which every asymmetric layout collapses to a single
   * full-width column.
   */
  collapseBelow: 768,
} as const;

/**
 * Optical vertical rhythm: bottom padding runs slightly larger than top, because
 * mathematically symmetric padding reads as top-heavy.
 */
export function sectionPadding(base: number = spacing.xxl) {
  return { paddingTop: base, paddingBottom: Math.round(base * 1.25) };
}

/** Hit slop that brings an undersized control up to `layout.minTouch`. */
export function hitSlopFor(size: number) {
  const pad = Math.max(0, Math.round((layout.minTouch - size) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
