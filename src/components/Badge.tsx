import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  contextColors,
  fern,
  radii,
  rarity as rarityTokens,
  semantic,
  spacing,
  text,
  type ContextName,
  type Rarity,
} from '../theme';

/**
 * Badges are square-ish (`radii.sm`), not pills — pill-shaped "New"/"Beta" tags are a
 * flagged cliché. The one pill that survives is the eyebrow label below.
 */

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning';

export const Badge = React.memo(function Badge({
  label,
  tone = 'neutral',
  context = 'bone',
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
    accent: { bg: fern[100], fg: fern[700] },
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

/**
 * Rarity badge. Colour is one of three redundant signals (label text and pip count are the
 * others), so rarity never depends on colour alone.
 */
export const RarityBadge = React.memo(function RarityBadge({
  rarity,
  style,
}: {
  rarity: Rarity;
  style?: StyleProp<ViewStyle>;
}) {
  const spec = rarityTokens[rarity];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: spec.shellTint, borderColor: spec.ring, borderWidth: 1 },
        style,
      ]}
    >
      <Text style={[text.caption, { color: spec.label }]}>{rarity}</Text>
    </View>
  );
});

/** Non-colour rarity redundancy. Readable in greyscale and to colourblind players. */
export const RarityPips = React.memo(function RarityPips({
  rarity,
  context = 'bone',
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
            { backgroundColor: i < spec.pips ? spec.label : c.hairlineHi },
          ]}
        />
      ))}
    </View>
  );
});

/**
 * The one surviving pill: a microscopic uppercase label that precedes a heading. This is
 * the only uppercase text in the product.
 */
export const Eyebrow = React.memo(function Eyebrow({
  label,
  context = 'bone',
  style,
}: {
  label: string;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <View style={[styles.eyebrow, { backgroundColor: c.sunken }, style]}>
      <Text style={[text.eyebrow, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
});

/** Rank tag for leaderboards. Mono, so digits align down a column. */
export const RankBadge = React.memo(function RankBadge({
  rank,
  highlight = false,
  context = 'bone',
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
        { backgroundColor: highlight ? fern[100] : c.sunken },
      ]}
    >
      <Text style={[text.stat, { color: highlight ? fern[700] : c.textMuted }]}>
        {rank}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.sm,
    alignSelf: 'flex-start',
  },
  eyebrow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
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
  rank: {
    minWidth: 30,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
});
