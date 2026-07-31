/**
 * CatSnap design system.
 *
 * Configuration: DESIGN_VARIANCE 8 / MOTION_INTENSITY 6 / VISUAL_DENSITY 4
 * Vibe archetype: Soft Structuralism. Layout archetype: Asymmetrical Bento.
 *
 * Full rationale, screen amendments and the pre-flight checklist live in /DESIGN.md.
 */

export {
  colors,
  fern,
  bone,
  arena,
  semantic,
  meter,
  shadowTint,
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
  requiredFontFiles,
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
  poseGlyph,
  poseLabel,
  type Rarity,
  type RaritySpec,
  type PoseClass,
} from './rarity';

/**
 * Icons: `phosphor-react-native` exclusively.
 *   weight="light" for content, weight="fill" for active state.
 * Stroke standardized to 1.5 at every size. Lucide, Feather, FontAwesome and Material
 * are banned as the default-AI icon choice.
 *
 * No emoji anywhere — not in UI, copy, push notification bodies, or accessibility labels.
 */
export const icon = {
  weightDefault: 'light' as const,
  weightActive: 'fill' as const,
  stroke: 1.5,
  size: { sm: 16, md: 20, lg: 24, xl: 28 },
} as const;
