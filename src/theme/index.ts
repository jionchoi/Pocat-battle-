/**
 * CatSnap design system.
 *
 * Configuration: DESIGN_VARIANCE 8 / MOTION_INTENSITY 6 / VISUAL_DENSITY 4
 * Vibe archetype: neutral chrome, one hot coral, saturated tier badges — the photograph
 * is the only thing on screen allowed to carry colour of its own.
 * Layout archetype: Asymmetrical Bento / masonry.
 *
 * Full rationale, screen amendments and the pre-flight checklist live in /DESIGN.md.
 */

export {
  colors,
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
  type ContextName,
  type ColorContext,
} from './colors';

export {
  typography,
  fontFamily,
  fontWeight,
  text,
  measure,
} from './typography';

export {
  spacing,
  layout,
  bezelPad,
  sectionPadding,
  hitSlopFor,
} from './spacing';

export { radii, concentric, avatarRadius } from './radii';

export {
  elevation,
  accentGlow,
  innerHighlight,
  glass,
  type ElevationLevel,
} from './elevation';

export {
  motion,
  spring,
  timing,
  press,
  iconWell,
  perpetual,
  staggerDelay,
  STAGGER_MS,
  useReduceMotion,
} from './motion';

export {
  rarity,
  rarityOrder,
  rarityGlow,
  poseGlyph,
  poseLabel,
  type Rarity,
  type RaritySpec,
  type PoseClass,
} from './rarity';

/**
 * Icons: `phosphor-react-native` exclusively.
 *
 * `regular` is the resting weight, not `light`. The icons in this product are small —
 * 11pt reaction glyphs on a photograph, 21pt tab glyphs on black — and Phosphor's light
 * stroke disappears at those sizes against anything but a plain field. `fill` marks the
 * active state, so weight and colour change together and the active item survives
 * greyscale.
 *
 * Lucide, Feather, FontAwesome and Material are banned as the default-AI icon choice.
 *
 * No emoji anywhere — not in UI, copy, push notification bodies, or accessibility labels.
 */
export const icon = {
  weightDefault: 'regular' as const,
  weightActive: 'fill' as const,
  stroke: 1.5,
  size: { sm: 16, md: 18, lg: 21, xl: 28 },
} as const;
