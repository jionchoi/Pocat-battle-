/**
 * Photo-tier encoding.
 *
 * Tier is the one thing on a card the player reads before the photograph, so it is
 * encoded as a solid badge that rides the top-right corner of every photo surface:
 *
 *   badge      ->  opaque fill + white glyph + white label, sitting on the image
 *   chip       ->  tinted fill + coloured label, for tier counts on neutral chrome
 *   base       ->  the pure hue, for meter fills and the reveal crest
 *
 * These four hues are a closed set. They are never used for buttons, links, focus rings
 * or any other interactive affordance — that is the accent's job exclusively, and the
 * separation is what keeps a Legendary badge from reading as a tappable control.
 *
 * Tier is never conveyed by colour alone: `label`, `glyph` and `pips` each carry the same
 * information for colourblind players and for grayscale screenshots.
 */

import type { PoseClass, Rarity } from '../models';

// Re-exported so component files can pull design + domain types from one place. `models`
// is the single definition; duplicating these unions here would let the two drift apart.
export type { PoseClass, Rarity };

export interface RaritySpec {
  /** The pure hue. Meter fills, the reveal crest, the glow. */
  base: string;
  /** Opaque badge fill for a badge sitting on a photograph. */
  badge: string;
  /** Tinted fill for a tier chip on neutral chrome. */
  chipTint: string;
  /** Foreground for a tier chip's label and count, against `chipTint`. */
  label: string;
  /** Outer-shell fill, where a card is tinted rather than badged. */
  shellTint: string;
  /** Hairline ring on that same shell. */
  ring: string;
  /** Phosphor icon name. Non-colour redundancy, and the badge's whole silhouette. */
  glyph: 'Crown' | 'Hexagon' | 'Diamond' | 'Circle';
  /** Non-colour redundancy: filled pip count, 1..4. */
  pips: 1 | 2 | 3 | 4;
  /** Only Legendary carries a glow behind its badge, and a sheen sweep on its card. */
  sheen: boolean;
}

/**
 * The ramp runs cool to warm as tier rises — grey, blue, violet, gold — which is the
 * order a player already expects from every collection game they have played. Fighting
 * that convention to be distinctive would cost comprehension and buy nothing.
 *
 * Legendary is the only tier with a glow, and the glow is a real shadow at the badge's
 * own hue rather than a gradient border. Gradient glow borders are a banned pattern.
 */
export const rarity: Record<Rarity, RaritySpec> = {
  Common: {
    base: '#8B8D98',
    badge: 'rgba(139, 141, 152, 0.90)',
    chipTint: 'rgba(139, 141, 152, 0.14)',
    label: '#6B6B70',
    shellTint: 'rgba(139, 141, 152, 0.07)',
    ring: 'rgba(139, 141, 152, 0.32)',
    glyph: 'Circle',
    pips: 1,
    sheen: false,
  },
  Rare: {
    base: '#3B82F6',
    badge: 'rgba(59, 130, 246, 0.92)',
    chipTint: 'rgba(59, 130, 246, 0.12)',
    label: '#2A6FE0',
    shellTint: 'rgba(59, 130, 246, 0.07)',
    ring: 'rgba(59, 130, 246, 0.30)',
    glyph: 'Diamond',
    pips: 2,
    sheen: false,
  },
  Epic: {
    base: '#A855F7',
    badge: 'rgba(168, 85, 247, 0.92)',
    chipTint: 'rgba(168, 85, 247, 0.12)',
    label: '#8B3FE0',
    shellTint: 'rgba(168, 85, 247, 0.07)',
    ring: 'rgba(168, 85, 247, 0.30)',
    glyph: 'Hexagon',
    pips: 3,
    sheen: false,
  },
  Legendary: {
    base: '#D9B94C',
    badge: 'rgba(217, 185, 76, 0.95)',
    chipTint: 'rgba(217, 185, 76, 0.14)',
    label: '#B4952C',
    shellTint: 'rgba(217, 185, 76, 0.12)',
    ring: 'rgba(217, 185, 76, 0.36)',
    glyph: 'Crown',
    pips: 4,
    sheen: true,
  },
};

export const rarityOrder: readonly Rarity[] = ['Common', 'Rare', 'Epic', 'Legendary'];

/**
 * Glow behind a Legendary badge or crest. Returned as a style object rather than a token,
 * because the radius has to scale with whatever it is sitting behind.
 */
export function rarityGlow(tier: Rarity, radius = 8) {
  const spec = rarity[tier];
  if (!spec.sheen) return null;

  return {
    shadowColor: spec.base,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: radius,
    shadowOpacity: 0.55,
  } as const;
}

/**
 * Poses carry NO colour — eleven more hues would obliterate the accent rule. They are
 * distinguished by glyph and label, rendered in `text` or `textMuted`.
 * Glyph names map to phosphor-react-native icons.
 */
export const poseGlyph: Record<PoseClass, string> = {
  yawning: 'Wind',
  jumping: 'ArrowUpRight',
  pouncing: 'Lightning',
  stretching: 'ArrowsOutSimple',
  grooming: 'Drop',
  sleeping: 'Moon',
  loafing: 'Bread',
  walking: 'Footprints',
  sitting: 'Armchair',
  standing: 'PawPrint',
  unknown: 'Question',
};

/** Human-readable pose names for the score breakdown row. */
export const poseLabel: Record<PoseClass, string> = {
  yawning: 'Mid-yawn',
  jumping: 'Mid-jump',
  pouncing: 'Pouncing',
  stretching: 'Stretching',
  grooming: 'Grooming',
  sleeping: 'Asleep',
  loafing: 'Loafing',
  walking: 'Walking',
  sitting: 'Sitting',
  standing: 'Standing',
  unknown: 'Unclear',
};
