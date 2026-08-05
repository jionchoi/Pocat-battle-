import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Circle,
  Crown,
  Diamond,
  Hexagon,
  type IconProps,
} from 'phosphor-react-native';

import {
  chrome,
  contextColors,
  fontFamily,
  marmalade,
  radii,
  rarity as rarityTokens,
  rarityGlow,
  semantic,
  spacing,
  text,
  type ContextName,
  type Rarity,
} from '../theme';

/**
 * Tier badges are pills carrying a glyph and an uppercase label, and they sit directly on
 * a photograph. That is the one place a pill is right: it is a *label on an image*, not a
 * "New"/"Beta" tag stuck to a menu item, and the rounded shape is what stops it reading
 * as a UI panel dropped onto the picture.
 */

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning';

export const Badge = React.memo(function Badge({
  label,
  tone = 'neutral',
  context = 'paper',
  style,
}: {
  label: string;
  tone?: BadgeTone;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  const palette = {
    neutral: { bg: c.sunken, fg: c.textMuted },
    accent: { bg: marmalade[100], fg: marmalade[600] },
    danger: { bg: semantic.dangerTint, fg: semantic.danger },
    warning: { bg: semantic.warningTint, fg: semantic.warning },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, style]}>
      <Text style={[text.caption, { color: palette.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});

const RARITY_GLYPHS: Record<Rarity, React.ComponentType<IconProps>> = {
  Common: Circle,
  Rare: Diamond,
  Epic: Hexagon,
  Legendary: Crown,
};

export type RarityBadgeSize = 'sm' | 'md' | 'lg';

const SIZES: Record<RarityBadgeSize, { glyph: number; font: number; padH: number; padV: number }> = {
  sm: { glyph: 8, font: 8, padH: 7, padV: 3 },
  md: { glyph: 9, font: 9, padH: 8, padV: 3.5 },
  lg: { glyph: 11, font: 10, padH: 10, padV: 4 },
};

/**
 * Rarity badge — an opaque pill for wearing on a photograph.
 *
 * Colour is one of three redundant signals: the glyph silhouette and the label text carry
 * the same information, so tier survives greyscale and colourblindness. Legendary is the
 * only tier that glows, and the glow is a shadow at its own hue rather than a gradient
 * border.
 *
 * `compact` drops the label and leaves a glyph disc, for grid tiles where a full pill
 * would cover a third of the thumbnail.
 */
export const RarityBadge = React.memo(function RarityBadge({
  rarity,
  size = 'md',
  compact = false,
  style,
}: {
  rarity: Rarity;
  size?: RarityBadgeSize;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const spec = rarityTokens[rarity];
  const Glyph = RARITY_GLYPHS[rarity];
  const dims = SIZES[size];
  const glow = rarityGlow(rarity, size === 'lg' ? 10 : 8);

  if (compact) {
    const disc = size === 'lg' ? 20 : 16;
    return (
      <View
        accessibilityLabel={rarity}
        style={[
          styles.disc,
          { width: disc, height: disc, backgroundColor: spec.badge },
          glow,
          style,
        ]}
      >
        <Glyph size={dims.glyph} weight="fill" color={chrome.text} />
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={rarity}
      style={[
        styles.rarityPill,
        {
          backgroundColor: spec.badge,
          paddingHorizontal: dims.padH,
          paddingVertical: dims.padV,
        },
        glow,
        style,
      ]}
    >
      <Glyph size={dims.glyph} weight="fill" color={chrome.text} />
      <Text style={[styles.rarityLabel, { fontSize: dims.font, lineHeight: dims.font + 3 }]}>
        {rarity}
      </Text>
    </View>
  );
});

/**
 * Tier chip — the tinted counterpart, for counting tiers on neutral chrome rather than
 * labelling one photo. Used by the Cat Dex header.
 */
export const RarityChip = React.memo(function RarityChip({
  rarity,
  count,
  style,
}: {
  rarity: Rarity;
  count: number;
  style?: StyleProp<ViewStyle>;
}) {
  const spec = rarityTokens[rarity];
  const Glyph = RARITY_GLYPHS[rarity];

  return (
    <View
      accessibilityLabel={`${count} ${rarity}`}
      style={[styles.chip, { backgroundColor: spec.chipTint }, style]}
    >
      <Glyph size={10} weight="fill" color={spec.base} />
      <Text style={[text.stat, styles.chipCount, { color: spec.label }]}>{count}</Text>
    </View>
  );
});

/** Non-colour rarity redundancy. Readable in greyscale and to colourblind players. */
export const RarityPips = React.memo(function RarityPips({
  rarity,
  context = 'paper',
}: {
  rarity: Rarity;
  context?: ContextName;
}) {
  const spec = rarityTokens[rarity];
  const c = contextColors(context);

  return (
    <View style={styles.pips} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.pip,
            { backgroundColor: i < spec.pips ? spec.base : c.hairlineHi },
          ]}
        />
      ))}
    </View>
  );
});

/**
 * The microscopic uppercase label that precedes a heading. Space Mono, wide-tracked, and
 * the only uppercase text in the product.
 */
export const Eyebrow = React.memo(function Eyebrow({
  label,
  context = 'paper',
  style,
}: {
  label: string;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <Text style={[text.eyebrow, { color: c.textFaint }, style]}>{label}</Text>
  );
});

/**
 * Score chip for a photo face — the app's own score, worn top-left the way the tier badge
 * is worn top-right. Opaque chrome black so it holds against any photograph.
 */
export const ScoreChip = React.memo(function ScoreChip({
  score,
  style,
}: {
  score: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityLabel={`Scored ${score}`}
      style={[styles.scoreChip, style]}
    >
      <Text style={[text.statSm, styles.scoreChipText]}>{score}</Text>
    </View>
  );
});

/** Rank tag for leaderboards. Tabular figures, so digits align down a column. */
export const RankBadge = React.memo(function RankBadge({
  rank,
  highlight = false,
  context = 'paper',
}: {
  rank: number;
  highlight?: boolean;
  context?: ContextName;
}) {
  const c = contextColors(context);

  return (
    <View
      style={[
        styles.rank,
        { backgroundColor: highlight ? marmalade[100] : c.sunken },
      ]}
    >
      <Text style={[text.stat, { color: highlight ? marmalade[600] : c.textMuted }]}>
        {rank}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
  rarityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
  /**
   * Not `text.eyebrow`: Space Mono is a wide face, and "LEGENDARY" set in it at this size
   * runs past the corner of a 148pt poster. The UI voice at its heaviest weight fits and
   * still reads as a stamp.
   */
  rarityLabel: {
    fontFamily: fontFamily.extrabold,
    textTransform: 'uppercase',
    color: chrome.text,
    letterSpacing: 0.3,
  },
  disc: {
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
  chipCount: {
    fontSize: 10,
    lineHeight: 14,
  },
  pips: {
    flexDirection: 'row',
    gap: 3,
  },
  pip: {
    width: 5,
    height: 5,
    borderRadius: radii.full,
  },
  scoreChip: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: chrome.onPhoto,
    alignSelf: 'flex-start',
  },
  scoreChipText: {
    color: chrome.text,
    fontSize: 11,
    lineHeight: 14,
  },
  rank: {
    minWidth: 30,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
});
