import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Trophy } from 'phosphor-react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Avatar } from '../../components/Avatar';
import { RarityBadge } from '../../components/Badge';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { pawRefreshControl } from '../../components/PawRefresh';
import { Screen, ScreenHeader } from '../../components/Screen';
import { SkeletonList } from '../../components/Skeleton';
import { socialApi } from '../../api/endpoints';
import { tierFor } from '../../constants/game';
import type { ChallengesStackParamList, MainTabParamList } from '../../navigation/types';
import type { LeaderboardEntry } from '../../models';
import { paper, layout, marmalade, radii, rarity, spacing, text } from '../../theme';
import { relativeTime } from '../../utils/format';

/**
 * The leaderboard.
 *
 * ## One board
 *
 * Two rows of segmented filters used to sit at the top — four scopes crossed with four
 * metrics, sixteen boards. That is a lot of control over a ranking the player has no
 * reason to trust yet, and it made the first thing on the screen a decision rather than a
 * result. What is left is the board the rest of the product already talks about: **your
 * neighbourhood, ranked by best single photo**. The scope is named in the subtitle rather
 * than offered as a choice, and the other cuts come back when there is a population big
 * enough to make them different.
 *
 * ## A podium, then a list
 *
 * First place gets a full-width photograph with its score at display size; second and
 * third share the row beneath it at half the width; fourth down are rows. Size encodes
 * rank, so the shape of the screen says who won before a numeral is read — and it stops
 * the top of a leaderboard being five identical lines where the only difference is a
 * number in a column.
 *
 * Every entry carries the photograph that earned the rank and its tier, because "94" is a
 * number and the photograph is the thing that scored it. Read from precomputed snapshots
 * on the server, never aggregated per request; the "updated" line is shown because a board
 * that is twelve minutes stale otherwise looks broken when it is working as designed.
 */

type Props = CompositeScreenProps<
  NativeStackScreenProps<ChallengesStackParamList, 'Leaderboard'>,
  BottomTabScreenProps<MainTabParamList>
>;

/** Enough to fill a podium and a screen of rows without paging. */
const BOARD_LIMIT = 25;

export function LeaderboardScreen({ navigation }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noBucket, setNoBucket] = useState(false);

  const fetchBoard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setError(null);

    try {
      const result = await socialApi.leaderboard({
        scope: 'neighborhood',
        metric: 'topPhoto',
        limit: BOARD_LIMIT,
      });
      setEntries(result.entries);
      setComputedAt(result.computedAt);
      // A null bucket means we have no home area yet, which is a different empty state
      // from "nobody is on the board".
      setNoBucket(result.bucket === null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not load the leaderboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  const openProfile = useCallback(
    (userId: string) => navigation.navigate('PublicProfile', { userId }),
    [navigation]
  );

  const [first, second, third, ...rest] = entries;

  return (
    <Screen
      scroll
      refreshing={refreshing}
      refreshControl={pawRefreshControl({
        refreshing,
        onRefresh: () => void fetchBoard(true),
      })}
    >
      <ScreenHeader
        title="Best scores"
        subtitle={
          computedAt
            ? `The highest-scoring photo each player has taken. Updated ${relativeTime(computedAt)}.`
            : 'The highest-scoring photo each player has taken.'
        }
      />

      {error ? (
        <InlineError
          message={error}
          onRetry={() => void fetchBoard()}
          style={styles.banner}
        />
      ) : null}

      {loading ? (
        <SkeletonList count={8} />
      ) : noBucket ? (
        <EmptyState
          title="No neighbourhood yet"
          body="Open the map once so we know roughly where you shoot. We store a rounded area, never your exact location."
          Glyph={Trophy}
          actionLabel="Open the map"
          onAction={() => navigation.navigate('MapTab', { screen: 'Map' })}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Not enough players yet"
          body="This board fills in as more people shoot nearby."
          Glyph={Trophy}
        />
      ) : (
        <>
          {first ? <Winner entry={first} onPress={() => openProfile(first.userId)} /> : null}

          {second || third ? (
            <View style={styles.runnersUp}>
              {[second, third].map((entry, index) =>
                entry ? (
                  <RunnerUp
                    key={entry.userId}
                    entry={entry}
                    onPress={() => openProfile(entry.userId)}
                  />
                ) : (
                  // Holds the column open when only two players have scored.
                  <View key={`pad-${index}`} style={styles.runnerUpPad} />
                )
              )}
            </View>
          ) : null}

          {rest.length > 0 ? (
            <View style={styles.rows}>
              {rest.map((entry) => (
                <BoardRow
                  key={entry.userId}
                  entry={entry}
                  onPress={() => openProfile(entry.userId)}
                />
              ))}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/**
 * First place.
 *
 * The photograph runs the width of the screen and the score sits on it at display size.
 * Everything else — who took it, what tier it landed in — rides the same image, because
 * splitting them into a caption block underneath would turn the winner into a card.
 */
const Winner = React.memo(function Winner({
  entry,
  onPress,
}: {
  entry: LeaderboardEntry;
  onPress: () => void;
}) {
  const tier = tierFor(entry.value);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`First place, ${entry.username}, ${entry.value}, ${tier}${
        entry.isSelf ? ', you' : ''
      }`}
      style={styles.winner}
    >
      <Image
        source={entry.topPhotoUrl || undefined}
        contentFit="cover"
        transition={220}
        style={StyleSheet.absoluteFill}
        accessible={false}
      />

      <View style={styles.winnerScrim} pointerEvents="none" />

      <View style={styles.winnerTop}>
        <View style={[styles.crown, { backgroundColor: rarity[tier].base }]}>
          <Trophy size={12} weight="fill" color="#FFFFFF" />
          <Text style={[text.eyebrow, styles.crownText]}>First</Text>
        </View>
        <RarityBadge rarity={tier} size="sm" />
      </View>

      <View style={styles.winnerFoot}>
        <View style={styles.winnerWho}>
          <Avatar uri={entry.avatarUrl} name={entry.username} size={26} />
          <Text style={[text.bodySm, styles.onPhoto]} numberOfLines={1}>
            {entry.isSelf ? `${entry.username} · you` : entry.username}
          </Text>
        </View>
        <Text style={[text.display, styles.onPhoto]}>{entry.value}</Text>
      </View>
    </Pressable>
  );
});

/** Second and third, at half the width and half the voice. */
const RunnerUp = React.memo(function RunnerUp({
  entry,
  onPress,
}: {
  entry: LeaderboardEntry;
  onPress: () => void;
}) {
  const tier = tierFor(entry.value);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${entry.rank}, ${entry.username}, ${entry.value}, ${tier}${
        entry.isSelf ? ', you' : ''
      }`}
      style={styles.runnerUp}
    >
      <View style={styles.runnerUpFrame}>
        <Image
          source={entry.topPhotoUrl || undefined}
          contentFit="cover"
          transition={200}
          style={StyleSheet.absoluteFill}
          accessible={false}
        />
        <View style={styles.runnerUpScrim} pointerEvents="none" />

        <View style={styles.runnerUpTop}>
          <View style={styles.rankDisc}>
            <Text style={[text.captionSm, styles.onPhoto]}>{entry.rank}</Text>
          </View>
          <RarityBadge rarity={tier} size="sm" compact />
        </View>

        <Text style={[text.statLg, styles.runnerUpScore]}>{entry.value}</Text>
      </View>

      <Text
        style={[
          text.caption,
          styles.runnerUpName,
          { color: entry.isSelf ? marmalade[600] : paper.textMuted },
        ]}
        numberOfLines={1}
      >
        {entry.isSelf ? 'You' : entry.username}
      </Text>
    </Pressable>
  );
});

/**
 * Fourth down.
 *
 * Hairline-separated, never boxed — a leaderboard is a list, and giving every row a card
 * with a shadow is the anti-card-overuse rule's textbook violation. The thumbnail is the
 * photograph that earned the rank; the tier rides it in the same corner it does everywhere
 * else in the product.
 */
const BoardRow = React.memo(function BoardRow({
  entry,
  onPress,
}: {
  entry: LeaderboardEntry;
  onPress: () => void;
}) {
  const tier = tierFor(entry.value);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${entry.rank}, ${entry.username}, ${entry.value}, ${tier}${
        entry.isSelf ? ', you' : ''
      }`}
      style={[styles.row, entry.isSelf ? { backgroundColor: marmalade[100] } : null]}
    >
      <Text style={[text.statSm, styles.rowRank]}>{entry.rank}</Text>

      <View style={styles.thumb}>
        <Image
          source={entry.topPhotoUrl || undefined}
          contentFit="cover"
          transition={160}
          style={StyleSheet.absoluteFill}
          accessible={false}
        />
      </View>

      <View style={styles.rowBody}>
        <Text
          style={[text.bodySm, { color: entry.isSelf ? marmalade[700] : paper.text }]}
          numberOfLines={1}
        >
          {entry.username}
          {entry.isSelf ? ' · you' : ''}
        </Text>
        <View style={styles.rowTier}>
          <View style={[styles.tierDot, { backgroundColor: rarity[tier].base }]} />
          <Text style={[text.caption, { color: paper.textMuted }]}>{tier}</Text>
        </View>
      </View>

      <Text style={[text.stat, { color: paper.text }]}>{entry.value}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  winner: {
    aspectRatio: 4 / 3,
    borderRadius: radii.xxl,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  /** Weighted to the foot, where the name and the score sit. */
  winnerScrim: {
    ...StyleSheet.absoluteFill,
    top: '40%',
    backgroundColor: 'rgba(11, 11, 12, 0.46)',
  },
  winnerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.sm + 2,
  },
  crown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  crownText: {
    color: '#FFFFFF',
  },
  winnerFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm + 2,
  },
  winnerWho: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  onPhoto: {
    color: '#FFFFFF',
  },
  runnersUp: {
    flexDirection: 'row',
    gap: layout.gridGap,
    marginTop: layout.gridGap,
  },
  runnerUp: {
    flex: 1,
  },
  runnerUpPad: {
    flex: 1,
  },
  runnerUpFrame: {
    aspectRatio: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
    justifyContent: 'flex-end',
  },
  runnerUpScrim: {
    ...StyleSheet.absoluteFill,
    top: '45%',
    backgroundColor: 'rgba(11, 11, 12, 0.42)',
  },
  runnerUpTop: {
    position: 'absolute',
    top: 7,
    left: 7,
    right: 7,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  rankDisc: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 11, 12, 0.55)',
  },
  runnerUpScore: {
    color: '#FFFFFF',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  runnerUpName: {
    marginTop: 6,
  },
  rows: {
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    minHeight: 60,
  },
  rowRank: {
    width: 22,
    color: paper.textFaint,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  rowBody: {
    flex: 1,
    gap: 3,
  },
  rowTier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tierDot: {
    width: 6,
    height: 6,
    borderRadius: radii.full,
  },
});
