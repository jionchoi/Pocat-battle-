import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { Trophy } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { challengeApi } from '../../api/endpoints';
import { Button } from '../../components/Button';
import { ChallengeBanner, PastChallengeRow } from '../../components/ChallengeBanner';
import { DividedGroup } from '../../components/Card';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { SkeletonBlock } from '../../components/Skeleton';
import type { Challenge } from '../../models';
import { radii, spacing } from '../../theme';
import type { ChallengesStackParamList } from '../../navigation/types';

/**
 * Challenges Hub (README section 5.4).
 *
 * The active prompt is the hero; past winners are a quiet list beneath it. This screen
 * is also the entry point to the leaderboard, the community feed and friends, because
 * those are all "what other people are doing" and belong behind one tab.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'ChallengesHub'>;

export function ChallengesHubScreen({ navigation }: Props) {
  const [active, setActive] = useState<Challenge[]>([]);
  const [past, setPast] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await challengeApi.active();
      setActive(result.active);
      setPast(result.past);
    } catch {
      setError('We could not load this week’s challenges.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
      }
    >
      <ScreenHeader
        title="Challenges"
        subtitle="A new prompt every week. Your best shot competes."
      />

      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <>
          <SkeletonBlock width="100%" height={230} radius={radii.xl} />
          <SkeletonBlock
            width="100%"
            height={230}
            radius={radii.xl}
            index={1}
            style={styles.gap}
          />
        </>
      ) : active.length === 0 ? (
        <EmptyState
          title="No challenge running"
          body="A new prompt opens shortly. In the meantime, the leaderboard is always live."
          Glyph={Trophy}
          actionLabel="See the leaderboard"
          onAction={() => navigation.navigate('Leaderboard')}
        />
      ) : (
        active.map((challenge) => (
          <ChallengeBanner
            key={challenge.id}
            challenge={challenge}
            onEnter={() =>
              navigation.navigate('ChallengeSubmission', {
                challengeId: challenge.id,
                title: challenge.title,
              })
            }
            onViewEntries={() =>
              navigation.navigate('ChallengeEntries', {
                challengeId: challenge.id,
                title: challenge.title,
              })
            }
            style={styles.banner}
          />
        ))
      )}

      <SectionHeader
        title="More from the community"
        description="See what other players are shooting, and how you rank."
      />

      <View style={styles.links}>
        <Button
          label="Community feed"
          variant="secondary"
          onPress={() => navigation.navigate('CommunityFeed')}
        />
        <Button
          label="Leaderboard"
          variant="secondary"
          onPress={() => navigation.navigate('Leaderboard')}
        />
        <Button
          label="Friends"
          variant="secondary"
          onPress={() => navigation.navigate('FriendsList')}
        />
      </View>

      {past.length > 0 ? (
        <>
          <SectionHeader title="Previous winners" />
          <DividedGroup>
            {past.map((challenge) => (
              <PastChallengeRow
                key={challenge.id}
                challenge={challenge}
                onPress={() =>
                  navigation.navigate('ChallengeEntries', {
                    challengeId: challenge.id,
                    title: challenge.title,
                  })
                }
              />
            ))}
          </DividedGroup>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: {
    marginTop: spacing.md,
  },
  banner: {
    marginTop: spacing.md,
  },
  links: {
    gap: spacing.xs,
  },
});
