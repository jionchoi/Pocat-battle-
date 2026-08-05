import { TextStyle } from 'react-native';

/**
 * Typography tokens.
 *
 * Three voices, each with one job:
 *
 *  - **Plus Jakarta Sans ExtraBold** carries display, headings and every number. It is a
 *    tightly-spaced geometric grotesk that goes genuinely heavy at 800, which is what lets
 *    a two-digit score sit on a photograph at 100px and still read as a graphic rather
 *    than as a caption. Numbers use it too — a photo app's numbers are trophies, and a
 *    trophy set in a text face is a receipt.
 *  - **Manrope** carries UI and body. It is the quieter grotesk: slightly wider, lower
 *    contrast, and legible at the 10–11px the metadata rows run at, where Jakarta's tight
 *    apertures start to close up.
 *  - **Space Mono** carries labels that are not prose — the uppercase eyebrows
 *    ("YOUR SCORE", "AUTO CAPTURE") and the technical annotations on a photo. It is the
 *    only voice with any personality, so it is rationed to text that is naming a mode.
 *
 * Banned faces: Inter, Roboto, Open Sans, Helvetica, Arial, Nunito, Baloo 2.
 *
 * All three ship from `@expo-google-fonts/*` and are loaded in App.tsx. Nothing here
 * depends on a file being downloaded by hand.
 */

export const fontFamily = {
  /** Display voice — headings, and every numeral in the product. */
  display: 'PlusJakartaSans_700Bold',
  displayBold: 'PlusJakartaSans_800ExtraBold',
  displayBlack: 'PlusJakartaSans_800ExtraBold',
  /** UI voice. */
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
  /** Mode labels and technical annotations. */
  mono: 'SpaceMono_400Regular',
  monoSemibold: 'SpaceMono_700Bold',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '800',
} as const;

/**
 * Body copy measure — roughly 62 characters at `body` size.
 * Long-form surfaces (Privacy & Data, onboarding, rescue narrative) must never run the
 * full width of a tablet.
 */
export const measure = 520;

type TypeToken =
  | 'display'
  | 'displayHuge'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySm'
  | 'caption'
  | 'captionSm'
  | 'eyebrow'
  | 'annotation'
  | 'stat'
  | 'statSm'
  | 'statMd'
  | 'statLg';

/**
 * Numerals are tabular everywhere.
 *
 * Scores, counts and ranks sit at the same spot on card after card, and a proportional
 * `1` makes a whole column visibly shift as the values change. `fontVariant` is
 * unreliable on Android for arbitrary faces, but Jakarta ships real tabular figures, so
 * this resolves rather than silently no-ops.
 */
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * `display` caps at 34 on mobile. Oversized H1s are banned — hierarchy comes from weight
 * and colour, not from scale inflation. `displayHuge` is the single exception, reserved
 * for the score reveal and the capture countdown, where one number is the entire screen.
 */
export const text: Record<TypeToken, TextStyle> = {
  displayHuge: {
    fontFamily: fontFamily.displayBold,
    fontSize: 88,
    lineHeight: 92,
    letterSpacing: -3.5,
    ...tabular,
  },
  display: {
    fontFamily: fontFamily.displayBold,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
  },
  h1: {
    fontFamily: fontFamily.displayBold,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.6,
  },
  h2: {
    fontFamily: fontFamily.displayBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  /** The hinge: h3 is where the voice hands off from Jakarta display to Manrope UI. */
  h3: {
    fontFamily: fontFamily.displayBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: 0,
  },
  bodySm: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
  },
  caption: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0,
  },
  /** The metadata line riding on a card face, where 11px would crowd the photo. */
  captionSm: {
    fontFamily: fontFamily.semibold,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.1,
  },
  /** Space Mono, uppercase. Names a mode; never prose. The only uppercase in the product. */
  eyebrow: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  /**
   * Space Mono, sentence case. Technical annotation printed onto a photograph — the
   * shooting conditions under a poster. Deliberately low contrast at the call site.
   */
  annotation: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  /** Inline counts sitting next to a glyph. */
  stat: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0,
    ...tabular,
  },
  /** Counts riding on a photo, where space is tight. */
  statSm: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0,
    ...tabular,
  },
  /** Per-component scores, stat-row headline figures. */
  statMd: {
    fontFamily: fontFamily.displayBold,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.4,
    ...tabular,
  },
  /** Score totals and the photo-detail overall. */
  statLg: {
    fontFamily: fontFamily.displayBold,
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: -1.6,
    ...tabular,
  },
};

/**
 * Orphan control is a `<Text>` *prop*, not a style — `textBreakStrategy="balanced"` on
 * Android, and `preventOrphan()` from utils/format on iOS, which has no equivalent.
 * There is deliberately no style token for it.
 */

export const typography = { fontFamily, fontWeight, text, measure } as const;
