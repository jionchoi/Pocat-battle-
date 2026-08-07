import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { UserPlus, UsersThree } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { feedApi, photoApi } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { CircleButton } from '../../components/CircleButton';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { PhotoCard } from '../../components/PhotoCard';
import { pawRefreshControl } from '../../components/PawRefresh';
import { Screen, ScreenHeader } from '../../components/Screen';
import { PhotoCardSkeleton } from '../../components/Skeleton';
import { showToast } from '../../components/Toast';
import { VoteRow } from '../../components/VoteButton';
import { FEED_CONFIG } from '../../constants/game';
import { usePhotoImpressions } from '../../hooks/usePhotoImpressions';
import type { PhotoWithAuthor, Reaction } from '../../models';
import { useAuthStore } from '../../store/authStore';
import { useReactionStore } from '../../store/reactionStore';
import { paper, layout, spacing, text } from '../../theme';
import type { ChallengesStackParamList } from '../../navigation/types';
import { FilterChips } from '../album/FilterChips';
import { relativeTime } from '../../utils/format';

/**
 * Community Feed (README section 9.5).
 *
 * Opt-in on both sides: only photos their owners chose to share appear here, and there
 * is no algorithmic ranking — newest first, so a player who shares a photo knows exactly
 * where it goes and for how long it stays visible.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'CommunityFeed'>;

const SCOPES = ['Everyone', 'Friends'] as const;

/** Title, subtitle and the scope chips, which sit above the list rather than in it. */
const HEADER_H = 128;

export function CommunityFeedScreen({ navigation }: Props) {
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

  const [photos, setPhotos] = useState<PhotoWithAuthor[]>([]);
  const [scope, setScope] = useState<'everyone' | 'friends'>('everyone');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextScope: 'everyone' | 'friends', isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const result = await feedApi.list({
          scope: nextScope,
          limit: FEED_CONFIG.pageSize,
        });
        setPhotos(result.photos);
        setCursor(result.nextCursor);
      } catch {
        setError('We could not load the feed.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const result = await feedApi.list({
        scope,
        cursor,
        limit: FEED_CONFIG.pageSize,
      });

      // Deduplicate: a photo shared mid-scroll shifts the cursor window and can repeat.
      setPhotos((current) => {
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...result.photos.filter((p) => !seen.has(p.id))];
      });
      setCursor(result.nextCursor);
    } catch {
      // A failed page is not worth a toast — the player can pull to refresh.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, scope]);

  const react = useCallback(async (photoId: string, reaction: Reaction) => {
    const previous = photos;

    setPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId
          ? { ...photo, myReaction: photo.myReaction === reaction ? null : reaction }
          : photo
      )
    );

    try {
      const result = await photoApi.vote(photoId, reaction);
      // The viral feed is served from a viewer-less cache and reads this device's own
      // reactions from the store, so a reaction cast here has to land there too or the
      // same photo would show as untapped on the home tab.
      useReactionStore.getState().set(photoId, result.myReaction);
      setPhotos((current) =>
        current.map((photo) =>
          photo.id === photoId
            ? {
                ...photo,
                reactions: result.reactions,
                myReaction: result.myReaction,
                voteCount:
                  result.reactions.laugh + result.reactions.love + result.reactions.wow,
              }
            : photo
        )
      );
    } catch {
      setPhotos(previous);
      showToast('We could not save that reaction.', 'error');
    }
  }, [photos]);

  const renderItem = useCallback(
    ({ item, index }: { item: PhotoWithAuthor; index: number }) => (
      <View style={styles.entry}>
        <View style={styles.authorRow}>
          <Avatar
            uri={item.author.avatarUrl}
            name={item.author.username}
            size={30}
            shape="circle"
          />
          <View style={styles.authorText}>
            <Text style={[text.bodySm, { color: paper.text }]} numberOfLines={1}>
              {item.author.username}
            </Text>
            <Text style={[text.caption, { color: paper.textMuted }]}>
              {relativeTime(item.capturedAt)}
            </Text>
          </View>
        </View>

        <PhotoCard
          photo={item}
          variant="feed"
          index={index}
          onPress={() => navigation.navigate('PublicProfile', { userId: item.author.id })}
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
        <ScreenHeader
          title="Community"
          subtitle="Photos other players chose to share. Newest first."
          /*
            The friends list lives behind this button now. It used to be one of three
            buttons on the Challenges hub; the other two collapsed into the map's layer
            toggle, and this is the screen with a Friends filter on it — so the place to
            manage who is in that filter is right here rather than a tab away.
          */
          right={
            <CircleButton
              Glyph={UserPlus}
              onPress={() => navigation.navigate('FriendsList')}
              accessibilityLabel="Friends"
              variant="solid"
              context="paper"
              size={36}
              glyphSize={18}
            />
          }
        />

        <FilterChips
          options={SCOPES}
          selected={scope === 'friends' ? 'Friends' : 'Everyone'}
          onSelect={(value) => setScope(value === 'Friends' ? 'friends' : 'everyone')}
        />

        {error ? (
          <InlineError message={error} onRetry={() => void load(scope)} />
        ) : null}
      </View>

      {loading ? (
        <View style={styles.list}>
          <PhotoCardSkeleton />
        </View>
      ) : photos.length === 0 ? (
        <EmptyState
          title={scope === 'friends' ? 'Nothing from friends yet' : 'The feed is quiet'}
          body={
            scope === 'friends'
              ? 'Add a few friends, or switch to Everyone to see what the wider community is shooting.'
              : 'Nobody nearby has shared a photo recently. Yours could be the first.'
          }
          Glyph={UsersThree}
        />
      ) : (
        <FlatList
          data={photos}
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
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          refreshControl={pawRefreshControl({
            refreshing,
            onRefresh: () => void load(scope, true),
          })}
          ListFooterComponent={
            loadingMore ? <PhotoCardSkeleton index={1} /> : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: layout.gutter,
    gap: spacing.sm,
  },
  list: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
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
  authorText: {
    flex: 1,
    gap: 1,
  },
  votes: {
    marginTop: spacing.xs,
  },
});
