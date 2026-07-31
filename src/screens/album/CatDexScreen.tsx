import React, { useCallback, useEffect, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { PawPrint } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { CatDexEntry } from '../../components/CatDexEntry';
import { EmptyState } from '../../components/EmptyState';
import { Screen, ScreenHeader } from '../../components/Screen';
import { PhotoCardSkeleton } from '../../components/Skeleton';
import type { Cat } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { layout, spacing } from '../../theme';
import type { AlbumStackParamList } from '../../navigation/types';
import { pluralize } from '../../utils/format';

/**
 * Cat Dex (README sections 5.3 and 9.3).
 *
 * One entry per unique real cat this player has photographed. This is the relationship
 * system: it is what the raise-a-pet idea turned into once the pet stopped being a
 * static thing you own and became an animal that lives on your street.
 */

type Props = NativeStackScreenProps<AlbumStackParamList, 'CatDex'>;

const COLUMNS = 3;

export function CatDexScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();

  const cats = useAlbumStore((s) => s.cats);
  const phase = useAlbumStore((s) => s.catdexPhase);
  const loadCatDex = useAlbumStore((s) => s.loadCatDex);

  useEffect(() => {
    void loadCatDex();
  }, [loadCatDex]);

  const cardWidth = useMemo(
    () => (width - layout.gutter * 2 - layout.gridGap * (COLUMNS - 1)) / COLUMNS,
    [width]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Cat; index: number }) => (
      <CatDexEntry
        cat={item}
        index={index}
        onPress={() => navigation.navigate('CatProfile', { catId: item.id })}
        style={{ width: cardWidth }}
      />
    ),
    [cardWidth, navigation]
  );

  const discovered = cats.filter((cat) => cat.discoveredByMe).length;

  if (phase === 'loading') {
    return (
      <Screen padded={false}>
        <View style={styles.header}>
          <ScreenHeader title="Cat Dex" />
        </View>
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={i} style={{ width: cardWidth }}>
              <PhotoCardSkeleton index={i} />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  if (cats.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Cat Dex" />
        <EmptyState
          title="No cats yet"
          body="Every cat you photograph gets an entry here. Photograph the same one twice and it starts keeping count."
          Glyph={PawPrint}
          actionLabel="Back to your album"
          onAction={() => navigation.navigate('PhotoAlbumGrid')}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <ScreenHeader
          title="Cat Dex"
          subtitle={`${pluralize(cats.length, 'cat')}, ${discovered} discovered by you`}
        />
      </View>

      <FlatList
        data={cats}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={phase === 'refreshing'}
            onRefresh={() => void loadCatDex()}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: layout.gutter,
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
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
    gap: layout.gridGap,
  },
  row: {
    gap: layout.gridGap,
  },
});
