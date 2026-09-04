import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Cat, Fire } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { feedApi, type ViralWindow } from '../../api/endpoints';
import { CircleButton } from '../../components/CircleButton';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { FeedPost } from '../../components/FeedPost';
import { pawRefreshControl } from '../../components/PawRefresh';
import { Screen, SectionHeader, Wordmark } from '../../components/Screen';
import { PhotoCardSkeleton } from '../../components/Skeleton';
import { TrendingCard, TrendingSlot } from '../../components/ViralCard';
import { usePhotoImpressions } from '../../hooks/usePhotoImpressions';
import { usePawGift } from '../../hooks/usePawGift';
import { usePhotoReaction } from '../../hooks/usePhotoReaction';
import {
  PLACEHOLDER_POSTS,
  PLACEHOLDER_TRENDING,
  SHOW_PLACEHOLDERS,
} from '../../constants/placeholders';
import type { PhotoWithAuthor } from '../../models';
import type { HomeStackParamList } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { useReactionStore } from '../../store/reactionStore';
import { layout, paper, spacing } from '../../theme';

/**
 * The viral feed — the app's home.
 *
 * Two surfaces, one ranking. A bento of the top five by heat, then everything below it as
 * posts. Both come from a single `/feed/viral` request, because "the bento is the top of
 * the feed" is a property of the ranking and not something the client should be
 * re-deciding.
 *
 * ## Two shapes because there are two jobs
 *
 * The bento is for *scanning* — portrait posters, rank numerals, no room for prose. The
 * posts are for *stopping* — author, caption, and a reaction bar you can press without
 * opening anything. Reacting is the whole point of a community feed, and it cannot live
 * one screen deeper than the photo it applies to.
 *
 * ## Why the rows are list items and not a header
 *
 * Impressions are the denominator of every community score in the product, so "seen" has
 * to mean genuinely on screen rather than "was in the page the server sent" — over-report
 * and you quietly depress somebody else's standing. A `ListHeaderComponent` gets no
 * viewability callbacks, so the bento rows are rows in `data` instead. `onViewableItemsChanged`
 * then reports every surface on the screen through one mechanism, at one threshold.
 */

type Props = NativeStackScreenProps<HomeStackParamList, 'ViralFeed'>;

/**
 * The feed shows one thing: whatever the ranking currently says is hot.
 *
 * It used to offer Today / This week / All time as chips. They are gone — not hidden, but
 * removed — because a time window is a *lever on a ranking*, and the ranking is not
 * settled yet. Shipping three ways to slice a result set nobody trusts yet asks the
 * player to tune something the product cannot currently explain, and it puts a row of
 * chrome above the first photo on the app's home screen.
 *
 * The window still exists server-side and the client still reads which one it was served
 * (see `served`), so bringing the control back later is re-adding a component rather than
 * re-plumbing the screen.
 */
const DEFAULT_WINDOW: ViralWindow = 'today';

/**
 * The bento: two across, then three across.
 *
 * The counts are the design. Rank 1 and 2 get half the screen each and rank 3–5 get a
 * third, so **size encodes rank** — the block is legible from across the room without
 * reading a single numeral. An even grid would throw that away, and a horizontal rail
 * (what this was) hid ranks 3–5 off the edge of the screen entirely.
 */
const BENTO_ROWS = [2, 3] as const;

/** Row aspects. The wider row runs shorter, so the two rows land at a similar height. */
const BENTO_ASPECT = [4 / 5, 3 / 4] as const;

/** Half a card on screen counts as seen. A sliver clipping into view is not a look. */
const VIEWABILITY = { itemVisiblePercentThreshold: 50 } as const;

/**
 * One row of the list.
 *
 * A discriminated union rather than three separate lists, so the whole screen is a single
 * virtualized scroller with one viewability pass over it.
 */
type FeedRow =
  | { kind: 'bento'; key: string; photos: PhotoWithAuthor[]; rankFrom: number; row: number }
  | { kind: 'section'; key: string }
  | { kind: 'post'; key: string; photo: PhotoWithAuthor; index: number };

/** Ids a row is showing — what gets reported when the row becomes viewable. */
function rowPhotoIds(row: FeedRow): string[] {
  if (row.kind === 'bento') return row.photos.map((p) => p.id);
  if (row.kind === 'post') return [row.photo.id];
  return [];
}

export function ViralFeedScreen({ navigation }: Props) {
  const impressions = usePhotoImpressions();
  const insets = useSafeAreaInsets();

  const [trending, setTrending] = useState<PhotoWithAuthor[]>([]);
  const [rising, setRising] = useState<PhotoWithAuthor[]>([]);
  const [served, setServed] = useState<ViralWindow>(DEFAULT_WINDOW);
  const [offset, setOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewerId = useAuthStore((s) => s.user?.id ?? null);

  /**
   * The page arrives from a shared cache with no viewer in it, so this device's own
   * reactions come from the store and are read per row rather than merged into a copy of
   * the list. Overlaying the whole array rebuilt every post on every tap; a post reads the
   * one value it needs and only that post re-renders.
   */
  const myReactions = useReactionStore((s) => s.byPhotoId);

  /* ------------------------------- loading ------------------------------- */

  /**
   * Fills the screen with the stand-in feed — five ranked photographs for the bento and six
   * posts under them, with real pictures on them. See `constants/placeholders`.
   *
   * Loaded into the same state the real page goes into rather than swapped in at render.
   * That is what makes a placeholder card *behave*: `patchPhoto` finds it, so tapping a
   * heart moves the count the way it will on a real one. Substituting at render left the
   * arrays frozen in a module constant, and the reaction lit up while its number sat still —
   * which previews the design and lies about the interaction.
   *
   * `offset` is cleared so paging cannot ask for page two of something that does not exist.
   */
  const showPlaceholders = useCallback(() => {
    setTrending(PLACEHOLDER_TRENDING);
    setRising(PLACEHOLDER_POSTS);
    setOffset(null);
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const page = await feedApi.viral({ window: DEFAULT_WINDOW });

        // The server may widen the window when a day is too thin to rank. Tracked because
        // paging has to keep asking for the same slice it was actually given.
        setServed(page.window);

        /*
         * All or nothing. Mixing a real photograph in with the stand-ins would put somebody's
         * genuine ranking beside invented ones with no way to tell which was which — so the
         * substitution only happens when the ranking produced nothing at all.
         */
        if (SHOW_PLACEHOLDERS && page.trending.length === 0 && page.rising.length === 0) {
          showPlaceholders();
          return;
        }

        setTrending(page.trending);
        setRising(page.rising);
        setOffset(page.nextOffset);
      } catch {
        /*
         * The banner still says what happened. The stand-ins go up behind it because an
         * unreachable API is the normal state while this is being designed, and an error
         * over an empty page shows nothing at all — which is the one thing a design pass
         * cannot work with. The message is the truth; the photographs are labelled fake by
         * the flag that put them there.
         */
        setError('We could not load the feed.');
        if (SHOW_PLACEHOLDERS) showPlaceholders();
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showPlaceholders]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (offset === null || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await feedApi.viral({ window: served, offset });

      // A photo that gained heat mid-scroll can cross a page boundary and repeat. Ranked
      // paging makes this ordinary rather than exceptional, so it is deduped every time.
      setRising((current) => {
        const seen = new Set([...current, ...trending].map((p) => p.id));
        return [...current, ...page.rising.filter((p) => !seen.has(p.id))];
      });
      setOffset(page.nextOffset);
    } catch {
      // A failed page is not worth a toast — pull to refresh is right there.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, offset, served, trending]);

  /* ------------------------------ reactions ------------------------------ */

  /**
   * A photo can be in the bento, the post list, or both — the bento is the top of the same
   * ranking. Patching both keeps a reaction from appearing to un-apply when the reader
   * scrolls back up to a poster of the photo they just reacted to.
   */
  const patchPhoto = useCallback(
    (photoId: string, apply: (photo: PhotoWithAuthor) => PhotoWithAuthor) => {
      const patch = (list: PhotoWithAuthor[]) =>
        list.some((p) => p.id === photoId)
          ? list.map((p) => (p.id === photoId ? apply(p) : p))
          : list;

      setTrending(patch);
      setRising(patch);
    },
    []
  );

  const react = usePhotoReaction(patchPhoto);

  // The same patcher, for the same reason: a photo can sit in the bento and the post list at
  // once, and a paw given to one copy has to show on the other.
  const givePaw = usePawGift(patchPhoto);

  /* -------------------------------- rows --------------------------------- */

  const rows = useMemo<FeedRow[]>(() => {
    const out: FeedRow[] = [];

    let taken = 0;
    BENTO_ROWS.forEach((count, row) => {
      const photos = trending.slice(taken, taken + count);

      if (photos.length > 0) {
        out.push({ kind: 'bento', key: `bento-${row}`, photos, rankFrom: taken + 1, row });
      }
      taken += count;
    });

    if (rising.length > 0) out.push({ kind: 'section', key: 'for-you' });

    rising.forEach((photo, index) => {
      out.push({ kind: 'post', key: photo.id, photo, index });
    });

    return out;
  }, [rising, trending]);

  /* ----------------------------- impressions ----------------------------- */

  const onViewableChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item?: FeedRow }[] }) => {
      const ids = viewableItems.flatMap((entry) =>
        entry.item ? rowPhotoIds(entry.item) : []
      );
      if (ids.length > 0) impressions.record(ids);
    },
    [impressions]
  );

  /* ------------------------------ rendering ------------------------------ */

  const openPhoto = useCallback(
    (photo: PhotoWithAuthor) => navigation.navigate('PhotoDetail', { photoId: photo.id }),
    [navigation]
  );

  const openAuthor = useCallback(
    (photo: PhotoWithAuthor) =>
      navigation.navigate('PublicProfile', { userId: photo.author.id }),
    [navigation]
  );

  const renderRow = useCallback(
    ({ item }: { item: FeedRow }) => {
      if (item.kind === 'bento') {
        const compact = item.row > 0;

        return (
          <View style={styles.bentoRow}>
            {item.photos.map((photo, i) => (
              <TrendingCard
                key={photo.id}
                photo={photo}
                rank={item.rankFrom + i}
                index={item.rankFrom + i - 1}
                aspect={BENTO_ASPECT[item.row] ?? 3 / 4}
                compact={compact}
                onPress={() => openPhoto(photo)}
                style={styles.bentoCard}
              />
            ))}
            {/*
              Holds the columns the ranking has not filled.

              These were bare spacers, there only so that two cards in a three-across row
              stayed card-sized instead of stretching across the gap — `flex: 1` on a spacer
              is the only way to hold a column open in a flex row. They now draw the slot as
              well as hold it, which is what makes the block legible before the feed is busy.
              With placeholders off, `TrendingSlot` renders the same bare spacer as before.
            */}
            {Array.from({ length: BENTO_ROWS[item.row] - item.photos.length }).map((_, i) => (
              <TrendingSlot
                key={`slot-${i}`}
                rank={item.rankFrom + item.photos.length + i}
                aspect={BENTO_ASPECT[item.row] ?? 3 / 4}
                style={styles.bentoCard}
              />
            ))}
          </View>
        );
      }

      if (item.kind === 'section') {
        return (
          <View style={styles.gutter}>
            <SectionHeader
              title="For you"
              description="Cats other people just posted."
              size="lg"
            />
          </View>
        );
      }

      return (
        <FeedPost
          photo={item.photo}
          myReaction={myReactions[item.photo.id] ?? null}
          index={item.index}
          isMine={viewerId !== null && item.photo.ownerId === viewerId}
          onPress={() => openPhoto(item.photo)}
          onPressAuthor={() => openAuthor(item.photo)}
          onReact={(reaction) => react(item.photo, reaction)}
          onGivePaw={() => givePaw(item.photo)}
        />
      );
    },
    [givePaw, myReactions, openAuthor, openPhoto, react, viewerId]
  );

  /*
   * Only reachable with placeholders off. With them on, `load` puts the stand-in feed into
   * this same state, so there is never nothing to draw.
   */
  const isEmpty = !loading && trending.length === 0 && rising.length === 0;

  /**
   * The feed owns its safe area rather than letting the shell inset it (`bleed` on
   * `Screen`). Padding the list's *content* puts the masthead in the same place a shell
   * inset would, but the scroller itself reaches both window edges — so photos pass under
   * the status bar and behind the tab bar instead of stopping at a band of bare page.
   */
  const contentStyle = useMemo(
    () => [styles.content, { paddingTop: insets.top }],
    [insets.top]
  );

  const header = useMemo(
    () => (
      <View>
        {/*
          A wordmark, not a screen title. This is the app's home: a 26pt heading over a
          feed of cats is a caption on something already obvious, and it pushed the first
          photo below the fold.
        */}
        <View style={[styles.gutter, styles.masthead]}>
          <Wordmark />
          {/*
            A camera, not a paw. The paw is the tab bar's shutter and stays there; up here
            it was the same glyph doing a second job in a different shape, which reads as a
            different action. A camera says what the button does without being read twice.
          */}
          <CircleButton
            Glyph={Camera}
            onPress={() =>
              navigation.getParent()?.navigate('MapTab', { screen: 'Capture' })
            }
            accessibilityLabel="Photograph a cat"
            variant="solid"
            context="paper"
            size={36}
            glyphSize={18}
          />
        </View>

        {trending.length > 0 ? (
          <View style={styles.gutter}>
            <SectionHeader
              title="Trending now"
              Glyph={Fire}
              size="lg"
              style={styles.bentoHeader}
            />
          </View>
        ) : null}

        {error ? (
          <View style={styles.gutter}>
            <InlineError message={error} onRetry={() => void load()} />
          </View>
        ) : null}

        {loading ? (
          <View style={styles.gutter}>
            <PhotoCardSkeleton />
          </View>
        ) : null}
      </View>
    ),
    [error, load, loading, navigation, trending.length]
  );

  return (
    <Screen bleed style={styles.screen} refreshing={refreshing}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isEmpty && !error ? (
            <EmptyState
              Glyph={Cat}
              title="Nothing is trending yet"
              body="Share a catch to the feed and it lands here. The ranking only needs a handful of photos to start moving."
              actionLabel="Go catch one"
              onAction={() => navigation.getParent()?.navigate('MapTab')}
            />
          ) : null
        }
        ItemSeparatorComponent={Separator}
        contentContainerStyle={contentStyle}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableChanged}
        viewabilityConfig={VIEWABILITY}
        // Prefetch a screen early so the feed does not visibly stall at the bottom.
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={1.5}
        refreshControl={pawRefreshControl({
          refreshing,
          onRefresh: () => void load(true),
        })}
      />
    </Screen>
  );
}

/**
 * Space between rows, not a rule.
 *
 * A hairline between full-bleed photographs reads as a table border. The rows are already
 * separated by their own whitespace and, for a post, by the author line that opens it.
 *
 * The gap depends on what it sits between, because two bento rows and two posts are not
 * the same relationship. The bento is one object in two rows, so its vertical gap matches
 * its horizontal one — anything larger and the block stops reading as a grid. Two posts
 * are two separate things and need real air. And the "For you" heading brings its own
 * top margin, so the separator before it gets out of the way.
 */
const Separator = ({
  leadingItem,
  trailingItem,
}: {
  leadingItem?: FeedRow;
  trailingItem?: FeedRow;
}) => {
  const betweenBento = leadingItem?.kind === 'bento' && trailingItem?.kind === 'bento';
  const beforeSection = trailingItem?.kind === 'section';

  const height = betweenBento
    ? layout.gridGap
    : beforeSection
      ? 0
      : spacing.xl;

  return <View style={{ height }} />;
};

const styles = StyleSheet.create({
  screen: {
    backgroundColor: paper.bg,
  },
  content: {
    paddingBottom: layout.tabBarClearance,
  },
  gutter: {
    paddingHorizontal: layout.gutter,
  },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  bentoHeader: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  bentoRow: {
    flexDirection: 'row',
    paddingHorizontal: layout.gutter,
    gap: layout.gridGap,
  },
  /**
   * Cards take their width from the row rather than from a measured constant. One
   * `flex: 1` covers two-across and three-across, and it stays correct on a rotated
   * tablet without anything recomputing.
   */
  bentoCard: {
    flex: 1,
  },
});
