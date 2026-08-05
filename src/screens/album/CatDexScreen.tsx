import React, { useCallback, useEffect, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { PawPrint } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RarityChip } from '../../components/Badge';
import { CatDexEntry } from '../../components/CatDexEntry';
import { EmptyState } from '../../components/EmptyState';
import { Screen, ScreenHeader } from '../../components/Screen';
import { PhotoCardSkeleton } from '../../components/Skeleton';
import { RARITIES } from '../../constants/game';
import type { Cat, Rarity } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { layout, paper, spacing, text } from '../../theme';
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

  /**
   * Tier counts, best-first.
   *
   * Reversed against `RARITIES` deliberately: the collection's value is at the top of the
   * ramp, so the Legendary count leads the row. Reading Common-first would put the least
   * interesting number where the eye lands.
   */
  const byTier = useMemo(() => {
    const counts = { Common: 0, Rare: 0, Epic: 0, Legendary: 0 } as Record<Rarity, number>;
    for (const cat of cats) counts[cat.bestTier] += 1;
    return [...RARITIES].reverse().filter((tier) => counts[tier] > 0).map((tier) => ({
      tier,
      count: counts[tier],
    }));
  }, [cats]);

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
        <ScreenHeader title="Cat Dex" style={styles.title} />
        <Text style={[text.bodySm, styles.subtitle]}>
          {`${pluralize(cats.length, 'cat')} spotted in your neighbourhood${
            discovered > 0 ? ` · ${discovered} you found first` : ''
          }`}
        </Text>

        {/*
          The tier tally sits under the count rather than over the grid. It is a summary
          of what is below, and a coloured row floating above an unrelated heading reads
          as a filter bar — which it is not; these are not tappable.
        */}
        <View style={styles.tiers}>
          {byTier.map(({ tier, count }) => (
            <RarityChip key={tier} rarity={tier} count={count} />
          ))}
        </View>
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
  title: {
    paddingBottom: 0,
  },
  subtitle: {
    marginTop: spacing.xxs,
    color: paper.textSubtle,
  },
  tiers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
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
