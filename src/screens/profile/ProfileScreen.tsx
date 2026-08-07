import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { CaretRight, Gear } from 'phosphor-react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Avatar } from '../../components/Avatar';
import { Badge, RarityBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { CircleButton } from '../../components/CircleButton';
import { MeterBar } from '../../components/ProgressBar';
import {
  BoardTrophy,
  profileStyles,
  RankPill,
  ShowcaseTile,
  StatRail,
  SHOWCASE_LIMIT,
} from '../../components/ProfileParts';
import { Screen, SectionHeader } from '../../components/Screen';
import { RARITIES, rankProgress, rankTitle } from '../../constants/game';
import type { Photo, Rarity } from '../../models';
import { useBoardStanding } from '../../hooks/useBoardStanding';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { paper, marmalade, layout, radii, spacing, text } from '../../theme';
import type { MainTabParamList, ProfileStackParamList } from '../../navigation/types';
import { compactNumber, pluralize, relativeTime } from '../../utils/format';

/**
 * Profile (README section 5.5).
 *
 * Photographer Rank, the album breakdown, and milestones earned from what the player has
 * actually done. Progression here is entirely cosmetic — rank unlocks filters and frames
 * and nothing else, which is why there is no "power" number anywhere on this screen.
 */

type Props = CompositeScreenProps<
  NativeStackScreenProps<ProfileStackParamList, 'Profile'>,
  BottomTabScreenProps<MainTabParamList>
>;

export function ProfileScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const showcaseTileWidth = (width - layout.gutter * 2 - layout.gridGap) / 2;

  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const standing = useBoardStanding();

  const photos = useAlbumStore((s) => s.photos);
  const cats = useAlbumStore((s) => s.cats);
  const load = useAlbumStore((s) => s.load);
  const loadCatDex = useAlbumStore((s) => s.loadCatDex);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  /**
   * Keyed on the signed-in id, not on mount.
   *
   * `albumStore.load` reads the current user out of the auth store and returns early when
   * there is none. On a cold start this screen mounts before the session has hydrated, so
   * a mount-only effect fired once into a null user and never ran again — the album stayed
   * empty until something else happened to load it, which is why the profile showed no
   * photos on a fresh launch. Depending on the id means the fetch happens the moment there
   * is somebody to fetch for, and again if the account changes.
   */
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    void load();
    void loadCatDex();
  }, [load, loadCatDex, userId]);

  const byTier = useMemo(() => {
    const counts: Record<Rarity, number> = {
      Common: 0,
      Rare: 0,
      Epic: 0,
      Legendary: 0,
    };
    for (const photo of photos) counts[photo.tier] += 1;
    return counts;
  }, [photos]);

  const best = useMemo(
    () =>
      photos.reduce<(typeof photos)[number] | null>(
        (top, photo) => (!top || photo.scores.total > top.scores.total ? photo : top),
        null
      ),
    [photos]
  );

  const discovered = cats.filter((cat) => cat.discoveredByMe).length;

  /**
   * The showcase.
   *
   * Pinned photos when there are any; otherwise the most recent, newest first. Recency is
   * the right fallback rather than top-scored — this is your own profile, and the thing
   * you came here to check is what you shot today, not what you shot best in March.
   *
   * An empty grid on your own profile reads as "you have nothing worth showing", which is
   * both discouraging and usually false. The fallback also quietly teaches what the pin
   * control on Photo Detail is for by showing the shape it produces.
   */
  const pinnedAny = photos.some((photo) => photo.showcased);

  const showcase = useMemo(() => {
    const pinned = photos.filter((photo) => photo.showcased);
    if (pinned.length > 0) return pinned.slice(0, SHOWCASE_LIMIT);

    return [...photos]
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
      .slice(0, SHOWCASE_LIMIT);
  }, [photos]);

  const openAlbum = () =>
    navigation.navigate('PhotoAlbumGrid');

  // Reachable for a beat between hydrate and the first `me` response. Deliberately blank
  // rather than a skeleton: it is one frame in practice, and a skeleton that flashes for
  // 16ms is more noticeable than nothing at all.
  if (!user) {
    return (
      <Screen>
        <View />
      </Screen>
    );
  }

  const quotaRatio =
    user.photoLimit === null ? 0 : Math.min(1, user.photoCount / user.photoLimit);
  const nearingQuota = user.photoLimit !== null && quotaRatio >= 0.85;

  return (
    <Screen scroll>
      {/*
        No "Profile" title. This screen opens with the player's own avatar and handle —
        a heading naming the screen above their own name is the app labelling something
        that has already introduced itself.
      */}
      <View style={styles.topBar}>
        <CircleButton
          Glyph={Gear}
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Settings"
          variant="solid"
          context="paper"
          size={36}
          glyphSize={18}
        />
      </View>

      <View style={profileStyles.head}>
        <Avatar uri={user.avatarUrl} name={user.username} size={64} />

        <View style={profileStyles.headBody}>
          <Text style={[text.h2, { color: paper.text }]} numberOfLines={1}>
            {user.username}
          </Text>

          {/* Rank is the player's title, so it rides right under the name rather than
              waiting in a card further down. */}
          <RankPill rank={user.photographerRank} />

          {user.proSubscriptionActive ? (
            <Badge label="Pro" tone="accent" style={styles.proBadge} />
          ) : null}
        </View>
      </View>

      <StatRail
        stats={[
          { label: 'Photos', value: user.photoCount },
          { label: 'Cats spotted', value: cats.length },
          { label: 'Best score', value: best?.scores.total ?? 0 },
          { label: 'Reactions', value: user.votesReceived },
        ]}
      />

      {/*
        Your own photograph on the board, if it made the top ten. Between the rail and the
        showcase: the rail is what you are, the showcase is what you chose to show, and
        this is neither — it is where the neighbourhood put you.
      */}
      {standing ? <BoardTrophy entry={standing} label="Your best score" /> : null}

      {/*
        The shop sits directly under the rail rather than at the foot of the screen.
        Buried below the album breakdown it was the last thing on a long scroll, which is
        where you put something nobody is meant to find. Here it reads as one more thing
        the figures above lead to, and it is still quiet enough — a secondary button, not
        a banner — that it does not shout over the photographs beneath it.
      */}
      <Button
        label="Open the shop"
        variant="secondary"
        fullWidth
        onPress={() => navigation.navigate('Shop')}
        style={styles.shopAction}
      />

      {/*
        The album lives here now. It gave up its slot in the tab bar to the capture
        shutter, so this is its front door — a real strip of photographs rather than a
        text row, because the album is a place you recognise by what is in it.
      */}
      <SectionHeader
        title={pinnedAny ? 'Showcase' : 'Recent'}
        description={
          pinnedAny
            ? 'Pinned to your public profile.'
            : 'Your latest shots. Pin the ones you want to show off from any photo.'
        }
        action={
          photos.length > 0 ? (
            <Button label="See all" variant="ghost" onPress={openAlbum} />
          ) : null
        }
      />

      {showcase.length > 0 ? (
        <View style={profileStyles.showcase}>
          {showcase.map((photo) => (
            <ShowcaseTile
              key={photo.id}
              photo={photo}
              width={showcaseTileWidth}
              onPress={() =>
                navigation.navigate('PhotoDetail', { photoId: photo.id })
              }
            />
          ))}
        </View>
      ) : (
        <Card>
          <Text style={[text.body, { color: paper.textMuted }]}>
            Nothing in your album yet. Photograph a cat and it lands here.
          </Text>
        </Card>
      )}

      <View style={styles.albumLinks}>
        <NavRow
          label="Photo album"
          detail={pluralize(photos.length, 'photo')}
          onPress={openAlbum}
        />
        <NavRow
          label="Cat Dex"
          detail={`${pluralize(cats.length, 'cat')}${
            discovered > 0 ? ` · ${discovered} you found first` : ''
          }`}
          onPress={() => navigation.navigate('CatDex')}
        />
      </View>

      {/* Rank is the one progression bar in the app, and it buys cosmetics only. */}
      <SectionHeader
        title="Progress"
        description="Rank unlocks filters and frames. It never buys a scoring advantage."
      />

      <Card>
        <View style={styles.rankRow}>
          <Text style={[text.h3, { color: paper.text }]}>
            {rankTitle(user.photographerRank)}
          </Text>
          <Text style={[text.stat, { color: paper.textMuted }]}>
            {compactNumber(user.photographerXp)}
          </Text>
        </View>

        <MeterBar
          ratio={rankProgress(user.photographerXp, user.photographerRank)}
          style={styles.rankMeter}
        />

        <Text style={[text.caption, { color: paper.textFaint }]}>
          {user.xpToNextRank > 0
            ? `${compactNumber(user.xpToNextRank)} XP to the next rank. Rank comes mostly from how people react to your photos — share them to climb. It unlocks filters and frames, never a scoring advantage.`
            : 'Top rank reached.'}
        </Text>
      </Card>

      {/* Album quota, and the Pro upsell trigger (README 5.7). Only shown as it starts
          to matter — a full-width upsell at 3 photos would be noise. */}
      {user.photoLimit !== null ? (
        <Card style={styles.quota}>
          <MeterBar
            ratio={quotaRatio}
            label="Album storage"
            valueLabel={`${user.photoCount} / ${user.photoLimit}`}
            color={nearingQuota ? undefined : marmalade[600]}
          />
          {nearingQuota ? (
            <>
              <Text style={[text.bodySm, styles.quotaBody]}>
                Your album is nearly full. Pro removes the limit and adds full-resolution
                exports.
              </Text>
              <Button
                label="See Pro"
                variant="secondary"
                onPress={() => navigation.navigate('Shop')}
                style={styles.quotaAction}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <SectionHeader
        title="Album breakdown"
        description={pluralize(photos.length, 'photo')}
      />

      <Card>
        <DividedGroup>
          {RARITIES.map((tier) => (
            <View key={tier} style={styles.tierRow}>
              <RarityBadge rarity={tier} />
              <View style={styles.tierBarTrack}>
                <View
                  style={[
                    styles.tierBarFill,
                    {
                      width: `${
                        photos.length === 0 ? 0 : (byTier[tier] / photos.length) * 100
                      }%`,
                    },
                  ]}
                />
              </View>
              <Text style={[text.stat, styles.tierCount]}>{byTier[tier]}</Text>
            </View>
          ))}
        </DividedGroup>
      </Card>

      {/*
        Milestones used to close this screen. They live on the Challenges hub now: they are
        instructions for what to go and shoot next, and that is the tab a player opens to
        be told what to do — not the one they open to look at what they have already done.
      */}
    </Screen>
  );
}

/**
 * A row that goes somewhere. Hairline-separated inside `DividedGroup`, no box — these are
 * navigation, and a card around each one would make two destinations look like two
 * sections.
 */
const NavRow = React.memo(function NavRow({
  label,
  detail,
  onPress,
}: {
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      style={styles.navRow}
    >
      <View style={styles.navRowBody}>
        <Text style={[text.h3, { color: paper.text }]}>{label}</Text>
        <Text style={[text.caption, { color: paper.textFaint }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <CaretRight size={16} color={paper.textFaint} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  proBadge: {
    marginTop: spacing.xxs,
  },
  showcaseTile: {
    aspectRatio: 4 / 5,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  albumLinks: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: paper.hairline,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  navRowBody: {
    flex: 1,
    gap: 2,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  rankMeter: {
    marginBottom: spacing.xs,
  },
  shopAction: {
    marginTop: spacing.lg,
  },
  quota: {
    marginTop: spacing.lg,
  },
  quotaBody: {
    color: paper.textMuted,
    marginTop: spacing.sm,
  },
  quotaAction: {
    marginTop: spacing.sm,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tierBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: paper.sunken,
    overflow: 'hidden',
  },
  tierBarFill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: marmalade[600],
  },
  tierCount: {
    minWidth: 28,
    textAlign: 'right',
    color: paper.textMuted,
  },
  bestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  bestBody: {
    flex: 1,
    gap: 2,
  },
  bestAction: {
    marginTop: spacing.md,
  },
});
