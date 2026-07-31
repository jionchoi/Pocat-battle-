import { TextStyle } from 'react-native';

/**
 * Typography tokens.
 *
 * Banned faces: Inter, Nunito, Nunito Sans, Baloo 2, Roboto, Open Sans, Helvetica, Arial.
 * Satoshi (Fontshare, bundled locally) carries the display and UI voice.
 * JetBrains Mono carries every number — it is tabular by construction, which keeps HP
 * score meters and the tallying total from jittering mid-reveal. `fontVariant: ['tabular-nums']`
 * is unreliable on Android, so the mono face is the fix rather than the CSS property.
 */

export const fontFamily = {
  medium: 'Satoshi-Medium',
  semibold: 'Satoshi-SemiBold',
  bold: 'Satoshi-Bold',
  black: 'Satoshi-Black',
  mono: 'JetBrainsMono_500Medium',
  monoSemibold: 'JetBrainsMono_600SemiBold',
} as const;

/** Weights in active use. The 400/700-only two-step is a flagged weakness. */
export const fontWeight = {
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '800',
} as const;

/**
 * Body copy measure — roughly 62 characters at `body` size.
 * Long-form surfaces (Privacy & Data, onboarding, rescue narrative) must never run
 * the full width of a tablet.
 */
export const measure = 520;

type TypeToken =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySm'
  | 'caption'
  | 'eyebrow'
  | 'stat'
  | 'statLg';

/**
 * `display` caps at 34 on mobile. Oversized H1s are banned — hierarchy comes from
 * weight and color, not from scale inflation.
 */
export const text: Record<TypeToken, TextStyle> = {
  display: {
    fontFamily: fontFamily.black,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.2,
  },
  h1: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.6,
  },
  h2: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  h3: {
    fontFamily: fontFamily.semibold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 24,
    letterSpacing: 0,
  },
  bodySm: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0,
  },
  caption: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  /** The only uppercase in the product. Pill-shaped label above a heading. */
  eyebrow: {
    fontFamily: fontFamily.semibold,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 2.0,
    textTransform: 'uppercase',
  },
  /** Mono — stat values, currency, timers, leaderboard ranks. */
  stat: {
    fontFamily: fontFamily.mono,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.4,
  },
  /** Mono — HP, damage, CP. */
  statLg: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
};

/**
 * Orphan control is a `<Text>` *prop*, not a style — `textBreakStrategy="balanced"` on
 * Android, and `preventOrphan()` from utils/format on iOS, which has no equivalent.
 * There is deliberately no style token for it.
 */

/**
 * Font files that must exist in `src/assets/fonts/` before the app will boot.
 *
 * Satoshi is NOT on Google Fonts — download the variable family from
 * fontshare.com/fonts/satoshi (free commercial licence). These are filenames rather than
 * `require()` calls on purpose: a `require()` of a font that has not been downloaded yet
 * fails at bundle time. Wire them up in the loader (see DESIGN.md section 8) once the
 * files are in place.
 */
export const requiredFontFiles = [
  'Satoshi-Medium.otf',
  'Satoshi-SemiBold.otf',
  'Satoshi-Bold.otf',
  'Satoshi-Black.otf',
] as const;

export const typography = { fontFamily, fontWeight, text, measure } as const;
