/**
 * CatSnap color tokens.
 *
 * The identity is a photo app that keeps score: an unlit neutral chrome so the cat
 * photograph is the only saturated thing on the screen, and one hot coral that marks
 * every place the player can act.
 *
 * Constraints enforced here:
 *  - Exactly one interactive accent (`marmalade`). Rarity hues are a separate, closed
 *    encoding (see rarity.ts) and are never used for buttons, links or focus.
 *  - Neutrals are true neutrals. A tinted grey beside a photograph shifts the photo's
 *    apparent white balance, which is the one thing a scoring app must not do.
 *  - The chrome black is #0B0B0C, not #000000 — pure black clips on OLED and kills the
 *    shadow that separates the floating tab bar from the page.
 */

/**
 * The single accent. A hot coral that reads as "hot / trending" as readily as it reads as
 * "tap this", so the viral feed never needs a second attention colour.
 */
export const marmalade = {
  /** Tint fill behind accent text — rank pills, accent badges. */
  100: '#FFF1EC',
  200: '#FFD9CE',
  500: '#FF7454',
  600: '#FF5A36',
  /** Pressed / hovered. */
  700: '#E44A28',
} as const;

/**
 * Sage — NOT a second accent. The muted complement used only where a success state must
 * sit beside neutral content without competing (verified pins, saved ticks, score bonus).
 */
export const sage = {
  100: '#E8F0EA',
  600: '#4F7A5C',
} as const;

/** Light context: everywhere except the camera and the score reveal. */
export const paper = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  /** Wells, chips, inputs, skeleton bases. */
  sunken: '#F2F2F4',
  /** The softer well, used where a chip would be too heavy — reaction bars, inline rows. */
  sunkenSoft: '#F7F7F8',
  hairline: '#F0F0F1',
  hairlineHi: '#E3E3E6',
  text: '#0B0B0C',
  textMuted: '#6B6B70',
  textFaint: '#A6A6AC',
  /** Between muted and faint — metadata that still has to be read at a glance. */
  textSubtle: '#8A8A90',
  /** Inset top highlight for the inner core of a bezel. */
  innerHighlight: 'rgba(255, 255, 255, 0.9)',
  /** Modal scrim. */
  scrim: 'rgba(11, 11, 12, 0.44)',
} as const;

/**
 * Dark immersive context: Capture Camera and Score Result.
 *
 * Surfaces here are white at low alpha rather than opaque greys, because everything on
 * these two screens floats over a live camera preview or a photograph. An opaque grey
 * panel over a photo reads as a rendering artefact; a translucent one reads as glass.
 */
export const arena = {
  bg: '#0B0B0C',
  surface: 'rgba(255, 255, 255, 0.12)',
  sunken: 'rgba(255, 255, 255, 0.06)',
  hairline: 'rgba(255, 255, 255, 0.15)',
  hairlineHi: 'rgba(255, 255, 255, 0.28)',
  text: '#FFFFFF',
  textMuted: 'rgba(255, 255, 255, 0.62)',
  textFaint: 'rgba(255, 255, 255, 0.32)',
  innerHighlight: 'rgba(255, 255, 255, 0.22)',
  scrim: 'rgba(0, 0, 0, 0.62)',
} as const;

/**
 * The chrome black. The floating tab bar, the rank chip on a poster, the scrim pills that
 * ride on a photograph — every opaque dark surface in the light context is this one value,
 * so they read as the same material.
 */
export const chrome = {
  fill: '#0B0B0C',
  /** Pills sitting directly on a photograph, where full opacity would look pasted on. */
  onPhoto: 'rgba(11, 11, 12, 0.55)',
  onPhotoStrong: 'rgba(11, 11, 12, 0.6)',
  text: '#FFFFFF',
  textMuted: '#8A8A90',
} as const;

/**
 * Gradient scrim stops for text overlaid on a photograph.
 *
 * Expressed as discrete stops rather than a gradient string: RN has no background
 * gradient, so these are stacked absolutely-positioned layers (see ViralCard's `Scrim`).
 */
export const photoScrim = {
  /** Poster cards — text occupies the bottom third, so the wash starts high. */
  posterTop: 'rgba(0, 0, 0, 0.26)',
  posterBottom: 'rgba(0, 0, 0, 0.78)',
  /** Wall and grid cards, where only a name sits at the bottom. */
  cardTop: 'rgba(0, 0, 0, 0.16)',
  cardBottom: 'rgba(0, 0, 0, 0.62)',
  /** Full-screen reveal, where the photo is background and the score is the subject. */
  revealTop: 'rgba(0, 0, 0, 0.55)',
  revealMid: 'rgba(0, 0, 0, 0.75)',
  revealBottom: 'rgba(0, 0, 0, 0.92)',
} as const;

/** Semantic states. */
export const semantic = {
  success: sage[600],
  successTint: sage[100],
  danger: '#D6402B',
  dangerTint: '#FCEAE7',
  warning: '#B4952C',
  warningTint: '#FBF3DD',
} as const;

/**
 * Meter fills. The warning and danger steps are used for the album quota as it fills;
 * that is semantic state, not a second accent.
 */
export const meter = {
  fill: marmalade[600],
  nearingLimit: semantic.warning,
  atLimit: semantic.danger,
  trackLight: '#F0F0F1',
  trackDark: 'rgba(255, 255, 255, 0.16)',
} as const;

/** Shadow hues. Neutral, matching the neutral chrome. */
export const shadowTint = {
  paper: '#000000',
  arena: '#000000',
} as const;

/**
 * Film grain tint.
 *
 * `Grain` (see components/Grain) scatters dots at this colour over the background. On the
 * light context it is now nearly off: the chrome is white, and dots on white read as dirt
 * rather than as tooth. It survives on the arena, where it does real work hiding banding
 * in the dark gradient behind the score.
 */
export const grain = {
  paper: 'rgba(11, 11, 12, 0.015)',
  arena: 'rgba(255, 255, 255, 0.035)',
} as const;

export type ContextName = 'paper' | 'arena';

export interface ColorContext {
  bg: string;
  surface: string;
  sunken: string;
  sunkenSoft: string;
  hairline: string;
  hairlineHi: string;
  text: string;
  textMuted: string;
  textFaint: string;
  textSubtle: string;
  innerHighlight: string;
  scrim: string;
  shadowTint: string;
  meterTrack: string;
  grain: string;
}

const contexts: Record<ContextName, ColorContext> = {
  paper: {
    ...paper,
    shadowTint: shadowTint.paper,
    meterTrack: meter.trackLight,
    grain: grain.paper,
  },
  arena: {
    ...arena,
    // The arena has no second well and no third text step: at 12% white a "softer" well
    // is invisible, and a fourth text alpha would be indistinguishable from the third.
    sunkenSoft: arena.sunken,
    textSubtle: arena.textMuted,
    shadowTint: shadowTint.arena,
    meterTrack: meter.trackDark,
    grain: grain.arena,
  },
};

/** Resolve the token set for a screen's committed context. */
export function contextColors(name: ContextName): ColorContext {
  return contexts[name];
}

export const colors = {
  marmalade,
  sage,
  paper,
  arena,
  chrome,
  photoScrim,
  semantic,
  meter,
  shadowTint,
  grain,
  contextColors,
} as const;
