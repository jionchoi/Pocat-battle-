import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { UserPlus, UsersThree } from 'phosphor-react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
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
import { usePawGift } from '../../hooks/usePawGift';
import { ReactionBar } from '../../components/ReactionBar';
import { FEED_CONFIG } from '../../constants/game';
import { usePhotoImpressions } from '../../hooks/usePhotoImpressions';
import type { PhotoWithAuthor, Reaction } from '../../models';
import { useAuthStore } from '../../store/authStore';
import { useReactionStore } from '../../store/reactionStore';
import { paper, layout, spacing, text } from '../../theme';
import type { ChallengesStackParamList, MainTabParamList } from '../../navigation/types';
import { FilterChips } from '../album/FilterChips';
import { relativeTime } from '../../utils/format';

/**
 * Community Feed (README section 9.5).
 *
 * Opt-in on both sides: only photos their owners chose to share appear here, and there
 * is no algorithmic ranking — newest first, so a player who shares a photo knows exactly
 * where it goes and for how long it stays visible.
 */

/**
 * Composite, so the screen can leave its own stack.
 *
 * Tapping your own name on this feed should open your profile, and your profile is a tab
 * rather than a route in this stack — see `openAuthor`. Without the tab navigator's props
 * mixed in, `navigate('ProfileTab', ...)` is a type error and a runtime guess.
 */
type Props = CompositeScreenProps<
  NativeStackScreenProps<ChallengesStackParamList, 'CommunityFeed'>,
  BottomTabScreenProps<MainTabParamList>
>;

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

  /**
   * The patcher `usePawGift` needs: find the photo, apply the updater, leave the rest alone.
   *
   * Reactions above still hand-roll their own optimistic update, which predates the shared
   * hook. Paws do not repeat that — a second hand-written optimistic update over *currency*
   * is a second place for a balance to drift, and this list is the only thing here that has
   * to be told where a photo lives.
   */
  const patchPhoto = useCallback(
    (photoId: string, apply: (photo: PhotoWithAuthor) => PhotoWithAuthor) => {
      setPhotos((current) =>
        current.map((photo) => (photo.id === photoId ? apply(photo) : photo))
      );
    },
    []
  );

  const givePaw = usePawGift(patchPhoto);

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

  /**
   * The author strip, which is now the way to a profile.
   *
   * Your own name goes to the Profile *tab* rather than to `PublicProfile` with your own id.
   * They are not the same screen: the public one is the read-only view a stranger gets, so
   * following your own name into it would show you a version of yourself with no settings, no
   * album and nothing to edit — and leave it sitting on top of a stack it does not belong in.
   */
  const openAuthor = useCallback(
    (photo: PhotoWithAuthor) => {
      if (photo.author.id === myId) {
        navigation.navigate('ProfileTab', { screen: 'Profile' });
        return;
      }
      navigation.navigate('PublicProfile', { userId: photo.author.id });
    },
    [myId, navigation]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: PhotoWithAuthor; index: number }) => (
      <View style={styles.entry}>
        {/*
          Pressable as one strip — avatar, name and timestamp together.

          The whole row is the target rather than the name alone: a 30pt avatar beside a line
          of caption text is two small targets where the player sees one object, and the row
          is already the shape of the thing being tapped.
        */}
        <Pressable
          style={styles.authorRow}
          onPress={() => openAuthor(item)}
          accessibilityRole="button"
          accessibilityLabel={
            item.author.id === myId
              ? 'Open your profile'
              : `Open ${item.author.username}'s profile`
          }
        >
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
        </Pressable>

        <PhotoCard
          photo={item}
          variant="feed"
          index={index}
          /*
           * The photograph opens the photograph.
           *
           * It used to open the author's profile, which meant the one thing on the card you
           * could not reach by tapping was the picture — and the trending rail, which is the
           * same content in a different shape, has opened `PhotoDetail` all along. The two
           * feeds now behave the same way, and the profile moved to the author strip above,
           * where a name and a face are what is being pressed.
           */
          onPress={() => navigation.navigate('PhotoDetail', { photoId: item.id })}
          footer={
            <ReactionBar
              photoId={item.id}
              reactions={item.reactions}
              myReaction={item.myReaction}
              onReact={(reaction) => void react(item.id, reaction)}
              pawCount={item.pawCount}
              onGivePaw={() => givePaw(item)}
              disabled={item.ownerId === myId}
              style={styles.votes}
            />
          }
        />
      </View>
    ),
    [givePaw, myId, navigation, openAuthor, react]
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
          style={styles.filters}
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
  /**
   * Breathing room around the scope chips, matching the album grid's.
   *
   * The header's `gap` spaces the chips from the title above and stops there, so the rail sat
   * hard against the first card — which reads as a header for that one photograph rather than
   * as a control over the whole feed.
   */
  filters: {
    marginTop: spacing.xxs,
    marginBottom: spacing.sm,
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
