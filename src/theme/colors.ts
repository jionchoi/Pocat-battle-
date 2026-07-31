/**
 * CatSnap color tokens.
 *
 * Constraints enforced here:
 *  - Exactly one accent family (`fern`). No second accent, no violet.
 *  - Every value under 80% saturation.
 *  - Never #000000 or #FFFFFF-on-pure-black. Off-black is warm.
 *  - All neutrals are tinted warm (hue ~30deg). There is no cool gray in this system.
 */

/**
 * The single accent. HSL(154, 39%, 30%) at `600`.
 * Doubles as the success color — a separate success green would be a second accent.
 */
export const fern = {
  100: '#E4EDE7',
  500: '#3C8763',
  600: '#2F6B4F',
  700: '#24543E',
} as const;

/** Light context: Map, Album, Cat Dex, Challenges, Profile, Shop, Settings. */
export const bone = {
  bg: '#FBF8F4',
  surface: '#FFFFFF',
  sunken: '#F4EFE8',
  hairline: 'rgba(33, 29, 24, 0.08)',
  hairlineHi: 'rgba(33, 29, 24, 0.14)',
  text: '#211D18',
  textMuted: '#6E655B',
  textFaint: '#9A9086',
  /** Inset top highlight for the inner core of a bezel. */
  innerHighlight: 'rgba(255, 255, 255, 0.9)',
  /** Modal scrim. */
  scrim: 'rgba(33, 29, 24, 0.44)',
} as const;

/** Dark immersive context: Capture Camera and Score Result. */
export const arena = {
  bg: '#14120F',
  surface: 'rgba(255, 255, 255, 0.06)',
  sunken: 'rgba(255, 255, 255, 0.03)',
  hairline: 'rgba(255, 255, 255, 0.10)',
  hairlineHi: 'rgba(255, 255, 255, 0.18)',
  text: '#F5F1EB',
  textMuted: 'rgba(245, 241, 235, 0.62)',
  textFaint: 'rgba(245, 241, 235, 0.38)',
  innerHighlight: 'rgba(255, 255, 255, 0.14)',
  scrim: 'rgba(10, 9, 7, 0.62)',
} as const;

/** Semantic states. Both sit in the warm family so errors never leave the product. */
export const semantic = {
  success: fern[600],
  successTint: fern[100],
  danger: '#A63B2E',
  dangerTint: '#F6E7E3',
  warning: '#9A6B1F',
  warningTint: '#F7EEDC',
} as const;

/**
 * Meter fills. The warning and danger steps are used for the album quota as it fills;
 * that is semantic state, not a second accent.
 */
export const meter = {
  fill: fern[600],
  nearingLimit: semantic.warning,
  atLimit: semantic.danger,
  /** Meter tracks are always a hairline well, never a filled gray bar. */
  trackLight: 'rgba(33, 29, 24, 0.08)',
  trackDark: 'rgba(255, 255, 255, 0.10)',
} as const;

/**
 * Shadow hues. Tinted to the background — generic black shadows are banned, and so is
 * pure #000000, including in shadows on the dark context.
 */
export const shadowTint = {
  bone: '#3A2E22',
  arena: '#0A0806',
} as const;

export type ContextName = 'bone' | 'arena';

export interface ColorContext {
  bg: string;
  surface: string;
  sunken: string;
  hairline: string;
  hairlineHi: string;
  text: string;
  textMuted: string;
  textFaint: string;
  innerHighlight: string;
  scrim: string;
  shadowTint: string;
  meterTrack: string;
}

const contexts: Record<ContextName, ColorContext> = {
  bone: { ...bone, shadowTint: shadowTint.bone, meterTrack: meter.trackLight },
  arena: { ...arena, shadowTint: shadowTint.arena, meterTrack: meter.trackDark },
};

/** Resolve the token set for a screen's committed context. */
export function contextColors(name: ContextName): ColorContext {
  return contexts[name];
}

export const colors = {
  fern,
  bone,
  arena,
  semantic,
  meter,
  shadowTint,
  contextColors,
} as const;
