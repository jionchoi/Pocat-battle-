import { Platform, ViewStyle } from 'react-native';
import { shadowTint, type ContextName } from './colors';

/**
 * Elevation.
 *
 * Default is `flat`. A card is only allowed a shadow when elevation actually
 * communicates hierarchy; everything else groups with a hairline or with negative space.
 * On a white page most cards are `hairline` — a shadow on every tile turns a grid into
 * a pile of receipts.
 *
 * The two loud steps are reserved: `floating` for the tab bar, which genuinely hovers
 * over scrolling content, and `modal` for sheets.
 *
 * ## No coloured shadows
 *
 * There is no accent glow and no per-tier halo. A saturated shape dropping a shadow in
 * its own hue is the single most recognisable tell of generated UI, and it was on the
 * primary button, the capture shutter, every Legendary badge and the tier crest at once.
 * Shape, fill and the ring around the shutter carry that work instead.
 */

export type ElevationLevel = 'flat' | 'hairline' | 'raised' | 'floating' | 'modal';

interface ShadowSpec {
  offsetY: number;
  radius: number;
  opacity: number;
  /** Android has no shadow-spread control; this is its approximation. */
  android: number;
}

const specs: Record<ElevationLevel, ShadowSpec> = {
  /** No shadow at all. The default for list rows, stat blocks, settings groups. */
  flat: { offsetY: 0, radius: 0, opacity: 0, android: 0 },
  /** Barely there — separates a white card from a white page and nothing more. */
  hairline: { offsetY: 1, radius: 2, opacity: 0.05, android: 1 },
  /** Collection cards, shop tiles, the photo-detail sheet. */
  raised: { offsetY: 6, radius: 16, opacity: 0.08, android: 3 },
  /** Floating tab bar. */
  floating: { offsetY: 12, radius: 24, opacity: 0.18, android: 8 },
  /** Bottom sheets, the score reveal's primary action. */
  modal: { offsetY: 20, radius: 40, opacity: 0.22, android: 14 },
};

/**
 * All shadows point straight down — a single consistent light source. Mixed shadow
 * directions across one product is a flagged weakness.
 */
export function elevation(
  level: ElevationLevel,
  context: ContextName = 'paper'
): ViewStyle {
  const spec = specs[level];
  if (spec.opacity === 0) return {};

  const tint = context === 'arena' ? shadowTint.arena : shadowTint.paper;
  const opacity = context === 'arena' ? Math.min(1, spec.opacity * 1.6) : spec.opacity;

  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: tint,
      shadowOffset: { width: 0, height: spec.offsetY },
      shadowRadius: spec.radius,
      shadowOpacity: opacity,
    },
    android: {
      elevation: spec.android,
      shadowColor: tint,
    },
    default: {},
  }) as ViewStyle;
}

/**
 * Inset top highlight for the inner core of a Double-Bezel.
 *
 * RN has no `inset` box-shadow, so the highlight is a real 1px top border. This is the
 * supported way to get edge refraction on native — faking it with a shadow does nothing.
 */
export function innerHighlight(color: string): ViewStyle {
  return {
    borderTopWidth: 1,
    borderTopColor: color,
  };
}

/**
 * Glass. `BlurView` must only ever wrap a fixed or absolutely-positioned element —
 * blur inside a ScrollView or FlatList row causes continuous GPU repaints and is the
 * fastest way to drop frames on mid-range Android.
 */
export const glass = {
  intensity: 40,
  tintLight: 'light' as const,
  tintDark: 'dark' as const,
} as const;
