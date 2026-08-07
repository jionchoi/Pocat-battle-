import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Storefront } from 'phosphor-react-native';

import { Badge, Eyebrow } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { SkeletonList } from '../../components/Skeleton';
import { SegmentRow } from '../../components/SegmentRow';
import { showToast } from '../../components/Toast';
import { shopApi, type CatalogResponse } from '../../api/endpoints';
import type { ShopItemKind } from '../../models';
import { paper, measure, spacing, text } from '../../theme';
import { useAuthStore } from '../../store/authStore';

/**
 * Shop (README section 5.7).
 *
 * The catalogue is server-owned so prices can change without an app release. Nothing here
 * can affect a score, and structurally cannot: there is no currency and no power to buy.
 * Filters change how a photo is captured, frames and themes change how it is displayed,
 * and Pro lifts the album cap and export resolution.
 *
 * Some items unlock by Photographer Rank instead of being sold — those show their rank
 * requirement rather than a price, because offering to sell something the player is
 * already earning would be a dark pattern.
 *
 * Purchases need a store transaction. The backend verifies every receipt with Apple or
 * Google before granting anything, so the button is wired but disabled until the IAP
 * module is configured; a fake local grant would be a lie about what the player owns.
 */

const TABS: { key: ShopItemKind; label: string }[] = [
  { key: 'filter', label: 'Filters' },
  { key: 'frame', label: 'Frames' },
  { key: 'theme', label: 'Themes' },
  { key: 'pro', label: 'Pro' },
];

export function ShopScreen() {
  const [tab, setTab] = useState<ShopItemKind>('filter');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rank = useAuthStore((s) => s.user?.photographerRank ?? 1);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await shopApi.catalog();
      setCatalog(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not load the shop.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const items = catalog?.items.filter((item) => item.kind === tab) ?? [];

  return (
    <Screen scroll>
      <ScreenHeader
        title="Shop"
        subtitle="Nothing here changes a score."
        right={
          catalog ? (
            <Badge label={`Rank ${catalog.photographerRank}`} tone="neutral" />
          ) : undefined
        }
      />

      <SegmentRow
        options={TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={(key) => setTab(key as ShopItemKind)}
      />

      {error ? (
        <InlineError message={error} onRetry={fetchCatalog} style={styles.banner} />
      ) : null}

      {tab === 'pro' && catalog?.proActive ? (
        <Card style={styles.proActive}>
          <Eyebrow label="Active" />
          <Text style={[text.h2, styles.proTitle]}>You have Pro</Text>
          <Text style={[text.body, { color: paper.textMuted }]}>
            Unlimited album storage and full-resolution exports are on. Manage or cancel in
            your {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} subscription settings.
          </Text>
        </Card>
      ) : null}

      <SectionHeader
        title={TABS.find((t) => t.key === tab)?.label ?? 'Items'}
        description={
          tab === 'pro'
            ? 'Unlimited album storage, full-resolution exports, and early access to challenges.'
            : tab === 'filter'
              ? 'Applied while you shoot. They change the look, never the score.'
              : tab === 'frame'
                ? 'Edges for the photos in your album and your showcase.'
                : 'How your album grid is laid out.'
        }
      />

      {loading ? (
        <SkeletonList count={4} showAvatar={false} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="New cosmetics land with seasonal events."
          Glyph={Storefront}
          compact
        />
      ) : (
        <Card>
          <DividedGroup>
            {items.map((item) => (
              <View key={item.id} style={styles.row}>
                <View style={styles.rowBody}>
                  <Text style={[text.h3, { color: paper.text }]}>{item.name}</Text>
                  <Text style={[text.bodySm, styles.rowDescription]}>
                    {item.description}
                  </Text>
                </View>

                {item.owned ? (
                  <Badge label={item.requiredRank > 0 ? 'Unlocked' : 'Owned'} tone="accent" />
                ) : item.requiredRank > 0 ? (
                  // Rank-gated: there is nothing to buy, so we say what it takes instead
                  // of showing a price the player cannot pay.
                  <Badge
                    label={`Rank ${item.requiredRank}`}
                    tone={rank >= item.requiredRank ? 'accent' : 'neutral'}
                  />
                ) : (
                  <Button
                    label={item.priceLabel}
                    onPress={() =>
                      showToast(
                        'In-app purchases are not switched on in this build',
                        'neutral'
                      )
                    }
                    variant="secondary"
                    disabled
                  />
                )}
              </View>
            ))}
          </DividedGroup>
        </Card>
      )}

      <Text style={[text.caption, styles.footnote]}>
        Purchases are verified with {Platform.OS === 'ios' ? 'Apple' : 'Google'} before
        anything is granted. Cosmetics are permanent; Pro renews until you cancel.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: spacing.md,
  },
  proActive: {
    marginTop: spacing.lg,
  },
  proTitle: {
    color: paper.text,
    marginTop: spacing.xs,
    marginBottom: spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowDescription: {
    color: paper.textMuted,
    maxWidth: measure,
  },
  footnote: {
    color: paper.textFaint,
    marginTop: spacing.xl,
    maxWidth: measure,
  },
});
