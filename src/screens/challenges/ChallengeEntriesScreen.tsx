import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Trophy } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { challengeApi, photoApi } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { PhotoCard } from '../../components/PhotoCard';
import { pawRefreshControl } from '../../components/PawRefresh';
import { Screen, ScreenHeader } from '../../components/Screen';
import { PhotoCardSkeleton } from '../../components/Skeleton';
import { showToast } from '../../components/Toast';
import { usePhotoImpressions } from '../../hooks/usePhotoImpressions';
import { VoteRow } from '../../components/VoteButton';
import type { PhotoWithAuthor, Reaction } from '../../models';
import { useAuthStore } from '../../store/authStore';
import { paper, layout, spacing, text } from '../../theme';
import type { ChallengesStackParamList } from '../../navigation/types';

/**
 * Challenge entries.
 *
 * Ranked by whatever decides this challenge — score or reactions — so the order on
 * screen is the order that will decide the winner. Showing entries in an order that has
 * nothing to do with judging would be actively misleading.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'ChallengeEntries'>;

/** Title and subtitle, which sit above the list rather than in it. */
const HEADER_H = 84;

export function ChallengeEntriesScreen({ route, navigation }: Props) {
  const { challengeId, title } = route.params;
  const myId = useAuthStore((s) => s.user?.id);
  const impressions = usePhotoImpressions();

  /**
   * A photo counts as seen once it is meaningfully on screen — this is what feeds the
   * community engagement ratio, so it must reflect real viewing, not what was fetched.
   */
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { key?: string | null }[] }) => {
      impressions.record(
        viewableItems
          .map((item) => item.key)
          .filter((key): key is string => typeof key === 'string')
      );
    },
    [impressions]
  );

  const [entries, setEntries] = useState<PhotoWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const result = await challengeApi.entries(challengeId);
        setEntries(result.entries);
      } catch {
        setError('We could not load the entries.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [challengeId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const react = useCallback(
    async (photoId: string, reaction: Reaction) => {
      const previous = entries;

      // Optimistic, because a reaction that lags feels broken. The server response
      // replaces the guess with the real tallies immediately after.
      setEntries((current) =>
        current.map((entry) =>
          entry.id === photoId
            ? { ...entry, myReaction: entry.myReaction === reaction ? null : reaction }
            : entry
        )
      );

      try {
        const result = await photoApi.vote(photoId, reaction);
        setEntries((current) =>
          current.map((entry) =>
            entry.id === photoId
              ? {
                  ...entry,
                  reactions: result.reactions,
                  myReaction: result.myReaction,
                  voteCount:
                    result.reactions.laugh + result.reactions.love + result.reactions.wow,
                }
              : entry
          )
        );
      } catch {
        setEntries(previous);
        showToast('We could not save that reaction.', 'error');
      }
    },
    [entries]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: PhotoWithAuthor; index: number }) => (
      <View style={styles.entry}>
        <View style={styles.authorRow}>
          <Text style={[text.stat, styles.rank, { color: paper.textMuted }]}>
            {index + 1}
          </Text>
          <Avatar
            uri={item.author.avatarUrl}
            name={item.author.username}
            size={28}
            shape="circle"
          />
          <Text style={[text.bodySm, styles.author]} numberOfLines={1}>
            {item.author.username}
          </Text>
          {index === 0 ? <Badge label="Leading" tone="accent" /> : null}
        </View>

        <PhotoCard
          photo={item}
          variant="feed"
          index={index}
          onPress={() =>
            navigation.navigate('PublicProfile', { userId: item.author.id })
          }
          footer={
            <VoteRow
              reactions={item.reactions}
              myReaction={item.myReaction}
              onReact={(reaction) => void react(item.id, reaction)}
              disabled={item.ownerId === myId}
              style={styles.votes}
            />
          }
        />
      </View>
    ),
    [myId, navigation, react]
  );

  return (
    <Screen padded={false} refreshing={refreshing} refreshIndicatorOffset={HEADER_H}>
      <View style={styles.header}>
        <ScreenHeader title={title} subtitle="Ranked in judging order." />
        {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
      </View>

      {loading ? (
        <View style={styles.list}>
          <PhotoCardSkeleton />
        </View>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          body="Nobody has entered this one. Yours would be the first."
          Glyph={Trophy}
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{
            // Half the card visible for a beat — enough to say it was actually looked at.
            itemVisiblePercentThreshold: 50,
            minimumViewTime: 600,
          }}
          refreshControl={pawRefreshControl({
            refreshing,
            onRefresh: () => void load(true),
          })}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: layout.gutter,
  },
  list: {
    paddingHorizontal: layout.gutter,
    paddingBottom: layout.tabBarClearance,
    gap: spacing.xl,
  },
  entry: {
    gap: spacing.xs,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rank: {
    minWidth: 20,
  },
  author: {
    flex: 1,
    color: paper.text,
  },
  votes: {
    marginTop: spacing.xs,
  },
});
