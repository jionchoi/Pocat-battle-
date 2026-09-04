import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Storefront } from 'phosphor-react-native';

import { Badge, Eyebrow } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { SkeletonList } from '../../components/Skeleton';
import { showToast } from '../../components/Toast';
import { shopApi, type CatalogResponse } from '../../api/endpoints';
import type { ShopItem, ShopItemKind } from '../../models';
import { chrome, marmalade, paper, measure, radii, spacing, text } from '../../theme';
import { compactNumber, countdownLabel } from '../../utils/format';
import { useAuthStore } from '../../store/authStore';
import { usePawStore } from '../../store/pawStore';

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

/**
 * The whole catalogue, in order, as bands of one page.
 *
 * It used to be four tabs. Tabs are the right control for a catalogue somebody is *shopping*
 * — one where they arrive knowing which aisle they want — and this is not that catalogue: it
 * is nine rows. Three of the four tabs held three items each, so the segmented control cost
 * a permanent 44pt strip and a tap to reveal, and it hid two thirds of what is for sale from
 * a player who had not thought to look. A shop nobody scrolls sells nothing.
 *
 * Order is deliberate and is not the old tab order. Pro leads because it is the one thing
 * here with a recurring price and the one a player is most likely to have come for;
 * everything else follows in the order it affects a photograph — how it was shot, how it is
 * framed, how the album shows it.
 */
const SECTIONS: { kind: ShopItemKind; title: string; description: string }[] = [
  {
    kind: 'pro',
    title: 'Cat Frame Pro',
    description:
      'Unlimited album storage, unlimited reveals, and full-resolution exports.',
  },
  {
    kind: 'filter',
    title: 'Filters',
    description: 'Applied while you shoot. They change the look, never the score.',
  },
  {
    kind: 'frame',
    title: 'Frames',
    description: 'Edges for the photos in your album and your showcase.',
  },
  {
    kind: 'theme',
    title: 'Themes',
    description: 'How your album grid is laid out.',
  },
];

export function ShopScreen() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Which row is mid-unlock, so one tap cannot become three. */
  const [unlocking, setUnlocking] = useState<string | null>(null);

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

  /**
   * Buying a cosmetic with paws.
   *
   * The response carries the whole catalogue, not just the row that changed, so it replaces
   * the state wholesale — one unlock lowers the wallet, which can put every other paw price
   * out of reach, and patching a single row would leave the others claiming otherwise.
   *
   * The balance is then re-read rather than derived from `walletBalance` on the response: the
   * store holds both buckets and this reply only knows about one of them. A second request on
   * an action this rare is not worth a second source of truth for money.
   */
  const unlock = useCallback(async (item: ShopItem) => {
    setUnlocking(item.id);

    try {
      const result = await shopApi.unlock(item.id);
      setCatalog(result);
      showToast(`${item.name} unlocked.`, 'success');
      await usePawStore.getState().refresh();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'We could not unlock that.',
        'error'
      );
      // Whatever the server thinks is true is worth re-reading after a refusal — an
      // "not enough paws" means this device's balance was stale.
      void usePawStore.getState().refresh();
    } finally {
      setUnlocking(null);
    }
  }, []);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const empty = !loading && (catalog?.items.length ?? 0) === 0;

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

      <PawWallet />

      {error ? (
        <InlineError message={error} onRetry={fetchCatalog} style={styles.banner} />
      ) : null}

      {catalog?.proActive ? (
        <Card style={styles.proActive}>
          <Eyebrow label="Active" />
          <Text style={[text.h2, styles.proTitle]}>You have Pro</Text>
          <Text style={[text.body, { color: paper.textMuted }]}>
            Unlimited album storage and full-resolution exports are on. Manage or cancel in
            your {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} subscription settings.
          </Text>
        </Card>
      ) : null}

      {loading ? (
        <SkeletonList count={6} showAvatar={false} />
      ) : empty ? (
        <EmptyState
          title="Nothing here yet"
          body="New cosmetics land with seasonal events."
          Glyph={Storefront}
          compact
        />
      ) : (
        /*
          Every section, every time — including one with nothing in it.

          A band that is empty this week is still information: it says the shop has frames in
          it and that none are on offer right now, which is a different thing from a shop that
          has never had frames. Hiding it would also mean the page reflows as seasonal content
          comes and goes, and a shop whose sections move is a shop a returning player has to
          re-learn.
        */
        SECTIONS.map((section) => {
          const items = catalog?.items.filter((item) => item.kind === section.kind) ?? [];
          if (items.length === 0) return null;

          return (
            <View key={section.kind}>
              <SectionHeader title={section.title} description={section.description} />
              <Card>
                <DividedGroup>
                  {items.map((item) => (
                    <ShopRow
                      key={item.id}
                      item={item}
                      rank={rank}
                      busy={unlocking === item.id}
                      onUnlock={unlock}
                    />
                  ))}
                </DividedGroup>
              </Card>
            </View>
          );
        })
      )}

      <Text style={[text.caption, styles.footnote]}>
        Purchases are verified with {Platform.OS === 'ios' ? 'Apple' : 'Google'} before
        anything is granted. Cosmetics are permanent; Pro renews until you cancel.
      </Text>
    </Screen>
  );
}

/**
 * What the player has to spend, above everything they could spend it on.
 *
 * A shop that opens on its catalogue is asking "what do you want"; a shop that opens on a
 * balance is answering "here is what you can have" first, which is the more useful order
 * when most of the page is priced in a currency the player earns rather than buys. It is
 * also the only place in the app where the balance is worth a whole card: on a photograph
 * the paw is a button, and here it is an amount.
 *
 * ## Two lines, because there are two balances
 *
 * The big numeral is the **wallet** — paws that were received, won or bought, and that never
 * expire. The line under it is the **weekly grant**, which does. They are not added together
 * and shown as one number, deliberately: a single total would be a promise the product cannot
 * keep, because part of it evaporates on a date. Everywhere else in the app the difference is
 * taught by the gift toast one paw at a time; this is the one screen where both are visible
 * at once, and the reset time is what makes the second one legible.
 *
 * The numbers are real. `pawStore` holds the server's answer and refreshes on launch — the
 * placeholder balance this used to draw is gone along with the rest of the treat vocabulary.
 * What is still a placeholder is the **buy** button: paw packs need `POST /shop/purchase`,
 * which is deliberately unbuilt.
 */
const PawWallet = React.memo(function PawWallet() {
  const wallet = usePawStore((s) => s.wallet);
  const grant = usePawStore((s) => s.grant);

  return (
    <View style={styles.wallet}>
      <Text allowFontScaling={false} style={styles.walletMark}>
        🐾
      </Text>

      <View style={styles.walletBody}>
        <Text style={[text.statLg, styles.walletBalance]}>{compactNumber(wallet)}</Text>
        <Text style={[text.caption, styles.walletLabel]}>
          paws · received, won and bought
        </Text>
        {/*
          The grant line only claims a reset time once it has one. `resetsAt` is null until
          the first balance lands from the server, and "resets in now" on a cold launch would
          be the app inventing a deadline.
        */}
        <Text style={[text.caption, styles.walletGrant]}>
          {`${grant.remaining} free this week`}
          {grant.resetsAt ? ` · resets ${countdownLabel(grant.resetsAt)}` : ''}
        </Text>
      </View>

      <Button
        label="Get more"
        variant="secondary"
        onPress={() => showToast('Paw packs are not switched on in this build')}
      />
    </View>
  );
});

/**
 * One catalogue row: what it is, and either a price, a rank, or a tick.
 *
 * Pulled out of the page when the tabs went. With four bands rendering the same row, an
 * inline map would have put the whole branch — owned, earned, sold — three levels deep
 * inside a `.map` inside a `.map`.
 */
const ShopRow = React.memo(function ShopRow({
  item,
  rank,
  busy,
  onUnlock,
}: {
  item: ShopItem;
  rank: number;
  busy: boolean;
  onUnlock: (item: ShopItem) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={[text.h3, { color: paper.text }]}>{item.name}</Text>
        <Text style={[text.bodySm, styles.rowDescription]}>{item.description}</Text>
      </View>

      {item.owned ? (
        <Badge label={item.requiredRank > 0 ? 'Unlocked' : 'Owned'} tone="accent" />
      ) : item.requiredRank > 0 ? (
        // Rank-gated: there is nothing to buy, so we say what it takes instead of showing
        // a price the player cannot pay.
        <Badge
          label={`Rank ${item.requiredRank}`}
          tone={rank >= item.requiredRank ? 'accent' : 'neutral'}
        />
      ) : item.pawPrice !== null ? (
        /*
          Priced in paws, and therefore the one thing on this screen that can actually be
          bought today. It takes the row's action slot from the money button, rather than
          sitting beside it: two prices for one item on one line is a decision the player has
          to make before they know what either currency is worth.

          **Not disabled when the wallet is short.** Same reasoning as the reveal button on
          Photo Detail — this device's balance is a snapshot, and greying the button out would
          tell a player who was paw'd thirty seconds ago that they cannot afford something they
          can. The server refuses, and the refusal names the reason.
        */
        <Button
          label={`${compactNumber(item.pawPrice)} 🐾`}
          onPress={() => onUnlock(item)}
          loading={busy}
          disabled={busy}
          variant="secondary"
          accessibilityHint={`Unlocks ${item.name} for ${item.pawPrice} paws`}
        />
      ) : (
        <Button
          label={item.priceLabel}
          onPress={() =>
            showToast('In-app purchases are not switched on in this build', 'neutral')
          }
          variant="secondary"
          disabled
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  banner: {
    marginTop: spacing.md,
  },
  /**
   * Dark, and the only dark block on the page.
   *
   * A wallet is not a section of the catalogue, and a white card among white cards would
   * read as the first item for sale. `chrome.fill` is the app's one opaque dark surface in
   * the light context — the same material as the tab bar — so this reads as chrome the page
   * is sitting under rather than as content inside it.
   */
  wallet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: chrome.fill,
  },
  walletMark: {
    fontSize: 30,
    lineHeight: 38,
  },
  walletBody: {
    flex: 1,
  },
  walletBalance: {
    color: chrome.text,
  },
  walletLabel: {
    color: marmalade[500],
  },
  /**
   * Quieter than the wallet's own label, because it is the second balance rather than a
   * second fact about the first. Same size, less weight of colour.
   */
  walletGrant: {
    color: marmalade[500],
    opacity: 0.75,
    marginTop: 2,
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
