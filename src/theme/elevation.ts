import { Platform, ViewStyle } from 'react-native';
import { marmalade, shadowTint, type ContextName } from './colors';

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
 * The accent's own coloured shadow, for the capture FAB and the reveal's primary action.
 *
 * A coral button dropping a neutral grey shadow looks unlit. Tinting the shadow to the
 * button's own hue is what makes it read as emitting rather than merely sitting there —
 * and it is the one place in the product a coloured shadow is allowed.
 */
export function accentGlow(strength: 'button' | 'fab' = 'button'): ViewStyle {
  const spec =
    strength === 'fab'
      ? { offsetY: 8, radius: 12, opacity: 0.45, android: 10 }
      : { offsetY: 10, radius: 16, opacity: 0.4, android: 10 };

  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: marmalade[600],
      shadowOffset: { width: 0, height: spec.offsetY },
      shadowRadius: spec.radius,
      shadowOpacity: spec.opacity,
    },
    android: {
      elevation: spec.android,
      shadowColor: marmalade[600],
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
