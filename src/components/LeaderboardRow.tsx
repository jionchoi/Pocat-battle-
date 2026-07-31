import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import type { LeaderboardEntry, LeaderboardMetric } from '../models';
import { rankTitle } from '../constants/game';
import {
  contextColors,
  fern,
  radii,
  spacing,
  text,
  type ContextName,
} from '../theme';
import { Avatar } from './Avatar';
import { RankBadge } from './Badge';
import { compactNumber } from '../utils/format';

/**
 * LeaderboardRow (README section 6).
 *
 * Hairline-separated, never boxed — a leaderboard is a list, and giving every row a card
 * with a shadow is the anti-card-overuse rule's textbook violation.
 *
 * The row carries a thumbnail of the photo that earned the rank, because "3,410 points"
 * means nothing on its own and the photo is the actual thing being ranked.
 */

const METRIC_UNIT: Record<LeaderboardMetric, (value: number) => string> = {
  // Community score is stored ×1000; shown as the percentage of viewers who reacted.
  community: (value) => `${Math.round((value / 1000) * 100)}% reacted`,
  votesReceived: (value) =>
    value === 1 ? '1 reaction' : `${compactNumber(value)} reactions`,
  challengeWins: (value) => (value === 1 ? '1 win' : `${value} wins`),
  topPhoto: (value) => `${value} best score`,
};

export const LeaderboardRow = React.memo(function LeaderboardRow({
  entry,
  metric,
  onPress,
  context = 'bone',
  style,
}: {
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  onPress: () => void;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${entry.rank}, ${entry.username}, ${METRIC_UNIT[metric](
        entry.value
      )}${entry.isSelf ? ', you' : ''}`}
      style={[
        styles.row,
        // The player's own row is tinted rather than boxed — enough to find at a glance
        // while scrolling, without breaking the list into cards.
        entry.isSelf ? { backgroundColor: fern[100] } : null,
        style,
      ]}
    >
      <RankBadge rank={entry.rank} highlight={entry.isSelf} context={context} />

      <Avatar uri={entry.avatarUrl} name={entry.username} size={36} context={context} />

      <View style={styles.text}>
        <Text style={[text.bodySm, { color: c.text }]} numberOfLines={1}>
          {entry.username}
          {entry.isSelf ? ' · you' : ''}
        </Text>
        <Text style={[text.caption, { color: c.textMuted }]} numberOfLines={1}>
          {METRIC_UNIT[metric](entry.value)}
        </Text>
      </View>

      {entry.topPhotoUrl ? (
        <Image
          source={entry.topPhotoUrl}
          contentFit="cover"
          transition={160}
          style={[styles.thumb, { backgroundColor: c.sunken }]}
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
});

/** Compact rank + title chip, used on profiles. */
export const RankChip = React.memo(function RankChip({
  rank,
  context = 'bone',
}: {
  rank: number;
  context?: ContextName;
}) {
  const c = contextColors(context);

  return (
    <View style={[styles.chip, { backgroundColor: c.sunken }]}>
      <Text style={[text.stat, { color: c.textMuted }]}>{rank}</Text>
      <Text style={[text.bodySm, { color: c.text }]}>{rankTitle(rank)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    minHeight: 56,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
});
