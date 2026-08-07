import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Crown } from 'phosphor-react-native';

import { RarityBadge, ScoreChip } from './Badge';
import { rankTitle, tierFor } from '../constants/game';
import type { LeaderboardEntry, Photo } from '../models';
import { marmalade, paper, radii, spacing, text } from '../theme';
import { compactNumber } from '../utils/format';

/**
 * The pieces both profiles are built from.
 *
 * Your own profile and a stranger's are the same screen with different permissions, so
 * they are the same components rather than two implementations that drift. What the public
 * one drops is everything that is *yours* — the settings gear, the shop, the album links,
 * the storage quota, the achievements — not the way a photographer is presented.
 */

/** Two across, and six is the cap the showcase toggle enforces on Photo Detail. */
export const SHOWCASE_LIMIT = 6;

/**
 * The player's title, directly under their name rather than in a card further down.
 */
export const RankPill = React.memo(function RankPill({ rank }: { rank: number }) {
  return (
    <View style={styles.rankPill}>
      <Crown size={11} weight="fill" color={marmalade[600]} />
      <Text style={[text.caption, styles.rankPillText]} numberOfLines={1}>
        {`Rank ${rank} · ${rankTitle(rank)}`}
      </Text>
    </View>
  );
});

/**
 * Four figures on one rule.
 *
 * Hairlines above, below and between, no card: these are a masthead for the screen, and
 * boxing them would make them look like one more section competing with the ones that
 * follow.
 */
export const StatRail = React.memo(function StatRail({
  stats,
  style,
}: {
  stats: { label: string; value: number }[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.statRail, style]}>
      {stats.map((stat, index) => (
        <View
          key={stat.label}
          style={[styles.railCell, index > 0 && styles.railDivider]}
        >
          <Text style={[text.statMd, { color: paper.text }]}>
            {compactNumber(stat.value)}
          </Text>
          <Text style={[text.captionSm, styles.railLabel]} numberOfLines={1}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
});

/**
 * A showcase cell: the photo, its score top-left, its tier top-right.
 *
 * Same corner grammar as every other photo surface in the product, so a player who has
 * learned to read a feed card can read this without being taught twice.
 */
export const ShowcaseTile = React.memo(function ShowcaseTile({
  photo,
  width,
  onPress,
}: {
  photo: Photo;
  /**
   * Measured, not a percentage. A wrapping flex row with a `gap` cannot hold two 50%
   * children — the gap pushes the second onto its own line — so the width is computed
   * from the window once and handed down.
   */
  width: number;
  /** Omitted on a stranger's profile: their album is private, so there is nothing to open. */
  onPress?: () => void;
}) {
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${photo.catNickname}, scored ${photo.scores.total}, ${photo.tier}`}
      style={[styles.showcaseTile, { width }]}
    >
      <Image
        source={photo.imageUrl || undefined}
        contentFit="cover"
        transition={200}
        style={StyleSheet.absoluteFill}
        accessible={false}
      />
      <View style={styles.showcaseCorners} pointerEvents="none">
        <ScoreChip score={photo.scores.total} />
        <RarityBadge rarity={photo.tier} size="sm" compact />
      </View>
    </Container>
  );
});

/**
 * A photograph that is on the board, shown on its photographer's profile.
 *
 * Only ever rendered for a top-ten placing (see `useBoardStanding`), so it is a trophy
 * rather than a rank readout — which is why the numeral is a badge on the corner of the
 * image and not a line of text under it. The photograph is the achievement; the number
 * says how far it got.
 *
 * It sits between the stat rail and the showcase because that is the seam between what a
 * player *is* and what they *chose to show*, and this is neither: it is what the crowd
 * put them at.
 */
export const BoardTrophy = React.memo(function BoardTrophy({
  entry,
  label,
  style,
}: {
  entry: LeaderboardEntry;
  /** "Your best score" on your own profile, "Best score" on somebody else's. */
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tier = tierFor(entry.value);

  return (
    <View style={[styles.trophy, style]}>
      <Image
        source={entry.topPhotoUrl || undefined}
        contentFit="cover"
        transition={220}
        style={StyleSheet.absoluteFill}
        accessibilityLabel={`Ranked ${entry.rank} in the neighbourhood, scored ${entry.value}`}
      />

      <View style={styles.trophyScrim} pointerEvents="none" />

      <View style={styles.trophyRank}>
        <Text style={[text.statSm, styles.onPhoto]}>{entry.rank}</Text>
      </View>

      <View style={styles.trophyFoot}>
        <View style={styles.trophyText}>
          <Text style={[text.eyebrow, styles.trophyEyebrow]}>{label}</Text>
          <Text style={[text.caption, styles.trophyMeta]} numberOfLines={1}>
            {`${tier} · ${entry.rank === 1 ? 'top of the neighbourhood' : `number ${entry.rank} nearby`}`}
          </Text>
        </View>
        <Text style={[text.statLg, styles.onPhoto]}>{entry.value}</Text>
      </View>
    </View>
  );
});

export const profileStyles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  headBody: {
    flex: 1,
    gap: 6,
  },
  showcase: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

const styles = StyleSheet.create({
  trophy: {
    marginTop: spacing.lg,
    /**
     * Portrait, and the same 4:5 as every other photo tile in the product. A cat is a
     * vertical subject and the old fixed 168pt made a full-width card roughly 2:1 — a
     * letterbox crop that cut the animal off at both ends.
     */
    aspectRatio: 4 / 5,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
    justifyContent: 'flex-end',
  },
  trophyScrim: {
    ...StyleSheet.absoluteFillObject,
    top: '40%',
    backgroundColor: 'rgba(11, 11, 12, 0.46)',
  },
  /** Top-left, where a rank numeral sits on every other photo surface in the product. */
  trophyRank: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 7,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 11, 12, 0.55)',
  },
  trophyFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm + 2,
  },
  trophyText: {
    flex: 1,
    gap: 2,
  },
  trophyEyebrow: {
    color: '#FFFFFF',
  },
  trophyMeta: {
    color: 'rgba(255, 255, 255, 0.76)',
  },
  onPhoto: {
    color: '#FFFFFF',
  },
  rankPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.full,
    backgroundColor: marmalade[100],
  },
  rankPillText: {
    color: marmalade[600],
    flexShrink: 1,
  },
  statRail: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: paper.hairline,
  },
  railCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  railDivider: {
    borderLeftWidth: 1,
    borderLeftColor: paper.hairline,
  },
  railLabel: {
    color: paper.textSubtle,
  },
  showcaseTile: {
    aspectRatio: 4 / 5,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  showcaseCorners: {
    position: 'absolute',
    top: 7,
    left: 7,
    right: 7,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
});
