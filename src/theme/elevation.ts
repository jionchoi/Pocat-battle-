import { Platform, ViewStyle } from 'react-native';
import { shadowTint, type ContextName } from './colors';

/**
 * Elevation.
 *
 * Generic black `box-shadow` is banned. Every shadow is tinted to its background hue and
 * spreads wide at low opacity — a diffusion shadow, not a drop shadow.
 *
 * Default is `flat`. A card is only allowed a shadow when elevation actually
 * communicates hierarchy; everything else groups with a hairline or with negative space.
 */

export type ElevationLevel = 'flat' | 'raised' | 'floating' | 'modal';

interface ShadowSpec {
  offsetY: number;
  radius: number;
  opacity: number;
  /** Android has no shadow-spread control; this is its approximation. */
  android: number;
}

const specs: Record<ElevationLevel, ShadowSpec> = {
  /** Hairline only. The default for list rows, stat blocks, settings groups. */
  flat: { offsetY: 0, radius: 0, opacity: 0, android: 0 },
  /** Collection cards, shop tiles. */
  raised: { offsetY: 6, radius: 18, opacity: 0.06, android: 2 },
  /** Floating tab bar, FAB, catch shutter. */
  floating: { offsetY: 14, radius: 32, opacity: 0.1, android: 6 },
  /** Bottom sheets, catch result card, level-up reveal. */
  modal: { offsetY: 22, radius: 48, opacity: 0.14, android: 12 },
};

/**
 * All shadows point straight down — a single consistent light source. Mixed shadow
 * directions across one product is a flagged weakness.
 */
export function elevation(
  level: ElevationLevel,
  context: ContextName = 'bone'
): ViewStyle {
  const spec = specs[level];
  if (spec.opacity === 0) return {};

  const tint = context === 'arena' ? shadowTint.arena : shadowTint.bone;
  const opacity = context === 'arena' ? spec.opacity * 1.6 : spec.opacity;

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
