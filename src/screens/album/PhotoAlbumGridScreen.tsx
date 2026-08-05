import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Cards, Image as ImageGlyph } from 'phosphor-react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { PhotoCard } from '../../components/PhotoCard';
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
  const loadingMore = useAlbumStore((s) => s.loadingMore);
  const load = useAlbumStore((s) => s.load);
  const loadMore = useAlbumStore((s) => s.loadMore);
  const setFilters = useAlbumStore((s) => s.setFilters);

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

  const loading = phase === 'loading';
  const showEmpty = phase === 'ready' && photos.length === 0;

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
          data={photos}
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
          refreshControl={
            <RefreshControl
              refreshing={phase === 'refreshing'}
              onRefresh={() => void load({ force: true })}
            />
          }
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
  filters: {
    marginTop: spacing.xxs,
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
