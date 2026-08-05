import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Trophy } from 'phosphor-react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { EmptyState, InlineError } from '../../components/EmptyState';
import { LeaderboardRow } from '../../components/LeaderboardRow';
import { Screen, ScreenHeader } from '../../components/Screen';
import { SkeletonList } from '../../components/Skeleton';
import { socialApi } from '../../api/endpoints';
import type { ChallengesStackParamList, MainTabParamList } from '../../navigation/types';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardScope,
} from '../../models';
import { paper, marmalade, radii, spacing, text } from '../../theme';
import { relativeTime } from '../../utils/format';

/**
 * Leaderboards (README section 5.4).
 *
 * Read from precomputed snapshots on the server, never aggregated per request. The "last
 * updated" line is shown because a board that is 12 minutes stale looks broken
 * otherwise, when actually it is by design.
 *
 * All three metrics are windowed to the last 30 days server-side, which is what keeps a
 * board winnable rather than permanently owned by whoever started first.
 */

type Props = CompositeScreenProps<
  NativeStackScreenProps<ChallengesStackParamList, 'Leaderboard'>,
  BottomTabScreenProps<MainTabParamList>
>;

const SCOPES: { key: LeaderboardScope; label: string }[] = [
  { key: 'neighborhood', label: 'Neighbourhood' },
  { key: 'city', label: 'City' },
  { key: 'global', label: 'Global' },
  { key: 'friends', label: 'Friends' },
];

/**
 * Community reception leads, because that is what actually decides rank. "Best shot" is
 * the app's own opinion and sits last on purpose — the two disagreeing is the
 * interesting part, not a bug.
 */
const METRICS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'community', label: 'Best received' },
  { key: 'votesReceived', label: 'Reactions' },
  { key: 'challengeWins', label: 'Challenge wins' },
  { key: 'topPhoto', label: 'Best shot' },
];

export function LeaderboardScreen({ navigation }: Props) {
  const [scope, setScope] = useState<LeaderboardScope>('neighborhood');
  const [metric, setMetric] = useState<LeaderboardMetric>('community');

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noBucket, setNoBucket] = useState(false);

  const fetchBoard = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      setError(null);

      try {
        const result = await socialApi.leaderboard({ scope, metric });
        setEntries(result.entries);
        setComputedAt(result.computedAt);
        // A null bucket means we have no home area yet, which is a different empty state
        // from "nobody is on the board".
        setNoBucket(result.bucket === null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'We could not load the leaderboard.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [metric, scope]
  );

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void fetchBoard(true)}
          tintColor={marmalade[600]}
        />
      }
    >
      <ScreenHeader
        title="Leaderboard"
        subtitle={
          metric === 'topPhoto'
            ? 'What the app thought of your shots. Rank is decided by the community, not this.'
            : computedAt
              ? `Ranked by how people reacted, over the last 30 days. Updated ${relativeTime(computedAt)}.`
              : 'Ranked by how people reacted, over the last 30 days.'
        }
      />

      <SegmentRow
        options={SCOPES.map((s) => ({ key: s.key, label: s.label }))}
        value={scope}
        onChange={(key) => setScope(key as LeaderboardScope)}
      />

      <SegmentRow
        options={METRICS.map((m) => ({ key: m.key, label: m.label }))}
        value={metric}
        onChange={(key) => setMetric(key as LeaderboardMetric)}
        style={styles.metricRow}
      />

      {error ? (
        <InlineError
          message={error}
          onRetry={() => void fetchBoard()}
          style={styles.banner}
        />
      ) : null}

      {loading ? (
        <SkeletonList count={10} />
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
          body={
            scope === 'friends'
              ? 'Add a few friends and their standings show up here.'
              : 'This board fills in as more people shoot nearby.'
          }
          Glyph={Trophy}
          actionLabel={scope === 'friends' ? 'Find friends' : undefined}
          onAction={
            scope === 'friends' ? () => navigation.navigate('FriendsList') : undefined
          }
        />
      ) : (
        <View>
          {entries.map((entry, index) => (
            <View
              key={entry.userId}
              style={
                index > 0
                  ? {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: paper.hairline,
                    }
                  : undefined
              }
            >
              <LeaderboardRow
                entry={entry}
                metric={metric}
                onPress={() =>
                  navigation.navigate('PublicProfile', { userId: entry.userId })
                }
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

/**
 * Shared segmented control. Pill-shaped active state; sliding an indicator is
 * unnecessary at this size and would fight the wrap onto a second line.
 */
export const SegmentRow = React.memo(function SegmentRow({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  style?: object;
}) {
  return (
    <View style={[styles.segments, style]}>
      {options.map((option) => {
        const active = option.key === value;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              {
                backgroundColor: active ? marmalade[100] : paper.sunken,
                borderColor: active ? marmalade[600] : 'transparent',
              },
            ]}
          >
            <Text style={[text.bodySm, { color: active ? marmalade[700] : paper.textMuted }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  metricRow: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  banner: {
    marginBottom: spacing.md,
  },
});
