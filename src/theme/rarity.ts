/**
 * Photo-tier encoding.
 *
 * The brief specified a "colored gradient border" per tier. Gradient glow borders are a
 * banned pattern, so the tier is encoded structurally instead:
 *
 *   shellTint  ->  8% fill on the OUTER shell of the card's Double-Bezel
 *   ring       ->  40% hairline ring on that same shell
 *   inner core ->  stays neutral, so the photo itself is never color-cast
 *
 * Tier is never conveyed by color alone: `label` and `pips` carry the same information
 * for colorblind players and for grayscale screenshots.
 */

import type { PoseClass, Rarity } from '../models';

// Re-exported so component files can pull design + domain types from one place. `models`
// is the single definition; duplicating these unions here would let the two drift apart.
export type { PoseClass, Rarity };

export interface RaritySpec {
  /** Base hue for shell tint and ring. Desaturated by construction. */
  base: string;
  /** Outer-shell fill. */
  shellTint: string;
  /** Hairline ring on the outer shell. */
  ring: string;
  /** Foreground for the rarity badge label. */
  label: string;
  /** Non-color redundancy: filled pip count, 1..4. */
  pips: 1 | 2 | 3 | 4;
  /** Only Legendary runs a perpetual sheen sweep — see motion.ts perpetual gate. */
  sheen: boolean;
}

export const rarity: Record<Rarity, RaritySpec> = {
  /** Stone. Neutral and deliberately unremarkable. */
  Common: {
    base: '#8A8078',
    shellTint: 'rgba(138, 128, 120, 0.08)',
    ring: 'rgba(138, 128, 120, 0.40)',
    label: '#6E655B',
    pips: 1,
    sheen: false,
  },
  /** Slate. HSL(203, 29%, 41%). */
  Rare: {
    base: '#4A6D86',
    shellTint: 'rgba(74, 109, 134, 0.08)',
    ring: 'rgba(74, 109, 134, 0.40)',
    label: '#3C5A70',
    pips: 2,
    sheen: false,
  },
  /**
   * Mulberry. HSL(320, 22%, 40%).
   * Not a Lila-Ban violation: the ban targets neon violet glows near hue 255 at high
   * saturation. This is a 22%-saturated wine at hue 320, used as a ring and an 8% tint.
   */
  Epic: {
    base: '#7C4F6B',
    shellTint: 'rgba(124, 79, 107, 0.08)',
    ring: 'rgba(124, 79, 107, 0.40)',
    label: '#66405A',
    pips: 3,
    sheen: false,
  },
  /** Brass. HSL(40, 57%, 40%). */
  Legendary: {
    base: '#A07A2C',
    shellTint: 'rgba(160, 122, 44, 0.10)',
    ring: 'rgba(160, 122, 44, 0.45)',
    label: '#856426',
    pips: 4,
    sheen: true,
  },
};

export const rarityOrder: readonly Rarity[] = ['Common', 'Rare', 'Epic', 'Legendary'];

/**
 * Poses carry NO color — eleven more hues would obliterate the one-accent rule. They are
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
