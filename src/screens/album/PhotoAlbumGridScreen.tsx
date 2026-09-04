import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Cards, Image as ImageGlyph } from 'phosphor-react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { PhotoCard } from '../../components/PhotoCard';
import { pawRefreshControl } from '../../components/PawRefresh';
import { Screen, ScreenHeader } from '../../components/Screen';
import { SearchField } from '../../components/TextField';
import { PhotoCardSkeleton } from '../../components/Skeleton';
import { Badge } from '../../components/Badge';
import { ProUpsell, shouldPromptForPro } from '../../components/ProUpsell';
import { RARITIES } from '../../constants/game';
import type { Photo, Rarity } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { layout, spacing } from '../../theme';
import type { AlbumStackParamList, MainTabParamList } from '../../navigation/types';
import { FilterChips } from './FilterChips';

/**
 * Photo Album Grid (README section 5.3).
 *
 * Two columns of PhotoCards, filterable by tier and searchable by the player's nickname
 * for the cat. All four states are implemented: skeleton grid, empty, error with the
 * cached photos still shown, and success.
 */

type Props = CompositeScreenProps<
  NativeStackScreenProps<AlbumStackParamList, 'PhotoAlbumGrid'>,
  BottomTabScreenProps<MainTabParamList>
>;

const COLUMNS = 2;

export function PhotoAlbumGridScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();

  const photos = useAlbumStore((s) => s.photos);
  const phase = useAlbumStore((s) => s.phase);
  const error = useAlbumStore((s) => s.error);
  const stale = useAlbumStore((s) => s.stale);
  const filters = useAlbumStore((s) => s.filters);
  const filtered = useAlbumStore((s) => s.filtered);
  const filtering = useAlbumStore((s) => s.filtering);
  const loadingMore = useAlbumStore((s) => s.loadingMore);
  const load = useAlbumStore((s) => s.load);
  const loadMore = useAlbumStore((s) => s.loadMore);
  const setFilters = useAlbumStore((s) => s.setFilters);
  const clearFilters = useAlbumStore((s) => s.clearFilters);

  /**
   * What the grid draws: the filtered answer when there is one, the album otherwise.
   *
   * `null` and `[]` are different and the difference is load-bearing — null is "no filter
   * set", empty is "the filter matched nothing" — which is what lets the empty state below
   * tell those two apart and offer the right way out of each.
   */
  const visible = filtered ?? photos;

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const photoCount = useAuthStore((s) => s.user?.photoCount ?? 0);
  const photoLimit = useAuthStore((s) => s.user?.photoLimit ?? null);

  const [search, setSearch] = useState(filters.search ?? '');
  /** Ids currently on screen — gates the Legendary sheen so off-screen cards stop. */
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  /**
   * The Pro upsell fires once per visit to this screen and never again — a modal that
   * reappears every time the album is opened is the pattern this app should not have.
   */
  const [upsellDismissed, setUpsellDismissed] = useState(false);

  // Keyed on the signed-in id: `load` reads the user out of the auth store and returns
  // early when there is none, so a mount-only effect silently no-ops on a cold start.
  useEffect(() => {
    if (!userId) return;
    void load();
  }, [load, userId]);

  /**
   * Debounced search. Without this every keystroke fires a request and a SQL query,
   * which is exactly what makes a filter field feel laggy.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.search ?? '') === search.trim()) return;
      setFilters({ ...filters, search: search.trim() || undefined });
    }, 280);

    return () => clearTimeout(timer);
  }, [filters, search, setFilters]);

  /*
   * Filters do not outlive a visit to this screen.
   *
   * They live in a store that outlives the component, so a rarity chip left on — or one set
   * for you by tapping a row in the profile's album breakdown — was still on the next time
   * the album was opened, from anywhere, with nothing on screen explaining why most of the
   * photographs were missing. A filter is a thing you do while you are looking, not a setting.
   *
   * Cleared on the way *out* rather than on the way in, so arriving with a filter already
   * chosen still works: `setFilters` runs before the navigation, and clearing on focus would
   * undo it a frame later.
   */
  useFocusEffect(
    useCallback(
      () => () => {
        setSearch('');
        clearFilters();
      },
      [clearFilters]
    )
  );

  const cardWidth = useMemo(
    () => (width - layout.gutter * 2 - layout.gridGap) / COLUMNS,
    [width]
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { key?: string | null }[] }) => {
      setVisibleIds(
        new Set(
          viewableItems
            .map((item) => item.key)
            .filter((key): key is string => typeof key === 'string')
        )
      );
    },
    []
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Photo; index: number }) => (
      <PhotoCard
        photo={item}
        index={index}
        visible={visibleIds.has(item.id)}
        onPress={() => navigation.navigate('PhotoDetail', { photoId: item.id })}
        style={{ width: cardWidth }}
      />
    ),
    [cardWidth, navigation, visibleIds]
  );

  // The skeleton covers a first load and a filter equally: both are "there is nothing to
  // show you yet", and a filter no longer borrows the pull-to-refresh spinner to say so.
  const loading = phase === 'loading' || filtering;
  const showEmpty = !loading && phase === 'ready' && visible.length === 0;

  /*
   * No paws on this screen.
   *
   * `Screen` draws the walking-paw indicator whenever `refreshing` is true. The album already
   * says it is working in two other ways — the grid keeps showing the photographs that are
   * already there, and a pull gets the platform's own release animation — so a third signal
   * walking across a full grid is noise. Opting out is simply not reporting the refresh.
   */
  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <ScreenHeader
          title="Your album"
          subtitle={
            photoLimit === null
              ? `${photoCount} photos`
              : `${photoCount} of ${photoLimit} photos`
          }
          right={
            <Button
              label="Cat Dex"
              variant="ghost"
              onPress={() => navigation.navigate('CatDex')}
            />
          }
        />

        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search by cat name"
          style={styles.search}
        />

        <FilterChips
          options={RARITIES}
          selected={filters.tier}
          onSelect={(tier) => setFilters({ ...filters, tier: tier as Rarity | undefined })}
          style={styles.filters}
        />

        {stale ? (
          <Badge
            label="Showing your last saved album"
            tone="warning"
            style={styles.stale}
          />
        ) : null}

        {error ? (
          <InlineError message={error} onRetry={() => void load({ force: true })} />
        ) : null}
      </View>

      <ProUpsell
        visible={!upsellDismissed && shouldPromptForPro(photoCount, photoLimit)}
        onClose={() => setUpsellDismissed(true)}
        onOpenShop={() => {
          setUpsellDismissed(true);
          navigation.navigate('ProfileTab', { screen: 'Shop' });
        }}
        photoCount={photoCount}
        photoLimit={photoLimit ?? 0}
      />

      {loading ? (
        <View style={[styles.grid, styles.skeletonGrid]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={{ width: cardWidth }}>
              <PhotoCardSkeleton index={i} />
            </View>
          ))}
        </View>
      ) : showEmpty ? (
        <EmptyState
          title={
            filters.tier || filters.search
              ? 'No photos match that'
              : 'No photos yet'
          }
          body={
            filters.tier || filters.search
              ? 'Try clearing the filter, or search for a different cat.'
              : 'The first one is usually on your own street. Open the camera and see what turns up.'
          }
          Glyph={filters.tier || filters.search ? Cards : ImageGlyph}
          actionLabel={filters.tier || filters.search ? 'Clear filters' : undefined}
          onAction={
            filters.tier || filters.search
              ? () => {
                  setSearch('');
                  setFilters({});
                }
              : undefined
          }
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 40 }}
          /*
            Only a real refresh, never a filter.

            `phase` is the album's own fetch, and `filtering` is deliberately not part of it —
            routing a filter through here is what dropped the platform's refresh spinner from
            the top of the screen on every chip tap, which reads as the page reloading because
            that is exactly what it was.
          */
          refreshControl={pawRefreshControl({
            refreshing: phase === 'refreshing',
            onRefresh: () => void load({ force: true }),
          })}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <PhotoCardSkeleton />
              </View>
            ) : null
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
   * Cancels one of the two helpings of space above the field.
   *
   * `ScreenHeader` carries its own `sectionPadding` — 15pt below the title — and this header
   * column adds a 12pt `gap` on top of it, so the field sat 27pt below the title and 16pt
   * above the chips. Removing the gap on this one edge leaves 15 and 16, which read as equal.
   */
  search: {
    marginTop: -spacing.sm,
  },
  filters: {
    marginTop: spacing.xxs,
    // Breathing room before the grid. Without it the first row of photographs sits directly
    // under the chips, so the filter reads as a header for that row rather than as a control
    // over the whole album.
    marginBottom: spacing.sm,
  },
  stale: {
    alignSelf: 'flex-start',
  },
  grid: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
    paddingBottom: layout.tabBarClearance,
    gap: layout.gridGap,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  row: {
    gap: layout.gridGap,
  },
  footer: {
    width: '48%',
    paddingTop: layout.gridGap,
  },
});
