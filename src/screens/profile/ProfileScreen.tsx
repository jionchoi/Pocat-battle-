import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { CaretRight, CheckCircle, Circle, Crown, Gear } from 'phosphor-react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Avatar } from '../../components/Avatar';
import { Badge, RarityBadge, ScoreChip } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { CircleButton } from '../../components/CircleButton';
import { MeterBar } from '../../components/ProgressBar';
import { Screen, SectionHeader } from '../../components/Screen';
import { RARITIES, rankProgress, rankTitle } from '../../constants/game';
import type { Photo, Rarity } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { paper, marmalade, icon, layout, radii, spacing, text } from '../../theme';
import type { MainTabParamList, ProfileStackParamList } from '../../navigation/types';
import { compactNumber, pluralize, relativeTime } from '../../utils/format';

/** Two across, and six is the cap the showcase toggle already enforces on Photo Detail. */
const SHOWCASE_LIMIT = 6;

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
    navigation.navigate('AlbumTab', { screen: 'PhotoAlbumGrid' });

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

      <View style={styles.head}>
        <Avatar uri={user.avatarUrl} name={user.username} size={64} />

        <View style={styles.headBody}>
          <Text style={[text.h2, { color: paper.text }]} numberOfLines={1}>
            {user.username}
          </Text>

          {/* Rank is the player's title, so it rides right under the name rather than
              waiting in a card further down. */}
          <View style={styles.rankPill}>
            <Crown size={11} weight="fill" color={marmalade[600]} />
            <Text style={[text.caption, styles.rankPillText]} numberOfLines={1}>
              {`Rank ${user.photographerRank} · ${rankTitle(user.photographerRank)}`}
            </Text>
          </View>

          {user.proSubscriptionActive ? (
            <Badge label="Pro" tone="accent" style={styles.proBadge} />
          ) : null}
        </View>
      </View>

      {/*
        Four figures on one rule. Hairlines above and below and between, no card: these
        are a masthead for the screen, and boxing them would make them look like one more
        section competing with the ones that follow.
      */}
      <View style={styles.statRail}>
        <RailStat label="Photos" value={user.photoCount} />
        <RailStat label="Cats spotted" value={cats.length} divided />
        <RailStat label="Best score" value={best?.scores.total ?? 0} divided />
        <RailStat label="Reactions" value={user.votesReceived} divided />
      </View>

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
        <View style={styles.showcase}>
          {showcase.map((photo) => (
            <ShowcaseTile
              key={photo.id}
              photo={photo}
              width={showcaseTileWidth}
              onPress={() =>
                navigation.navigate('AlbumTab', {
                  screen: 'PhotoDetail',
                  params: { photoId: photo.id },
                })
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
          onPress={() => navigation.navigate('AlbumTab', { screen: 'CatDex' })}
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

      <SectionHeader
        title="Milestones"
        description="Earned from what you have actually done."
      />

      <Card>
        <DividedGroup>
          <Milestone
            label="First shot"
            achieved={photos.length >= 1}
            detail="Photograph a cat."
          />
          <Milestone
            label="Ten in the album"
            achieved={photos.length >= 10}
            detail={`${Math.min(photos.length, 10)} of 10 photos.`}
          />
          <Milestone
            label="Rare moment"
            achieved={byTier.Epic + byTier.Legendary > 0}
            detail="Score an Epic or Legendary shot."
          />
          <Milestone
            label="Regular"
            achieved={cats.some((cat) => cat.encounterCount >= 5)}
            detail="Photograph the same cat five times."
          />
          <Milestone
            label="Discoverer"
            achieved={discovered >= 1}
            detail="Be the first to photograph a cat."
          />
          <Milestone
            label="Well received"
            achieved={user.votesReceived >= 25}
            detail={`${Math.min(user.votesReceived, 25)} of 25 reactions received.`}
          />
        </DividedGroup>
      </Card>

      <Button
        label="Open the shop"
        variant="secondary"
        fullWidth
        onPress={() => navigation.navigate('Shop')}
        style={styles.shopAction}
      />
    </Screen>
  );
}

/**
 * One figure in the masthead rail.
 *
 * The divider is a border on the cell rather than a separate element, so the four cells
 * stay a single flex row that divides the width evenly however many of them there are.
 */
const RailStat = React.memo(function RailStat({
  label,
  value,
  divided = false,
}: {
  label: string;
  value: number;
  divided?: boolean;
}) {
  return (
    <View style={[styles.railCell, divided && styles.railDivider]}>
      <Text style={[text.statMd, { color: paper.text }]}>{compactNumber(value)}</Text>
      <Text style={[text.captionSm, styles.railLabel]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});

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

/**
 * A showcase cell: the photo, its score top-left, its tier top-right.
 *
 * Same corner grammar as every other photo surface in the product — score on the left,
 * tier on the right — so a player who has learned to read a feed card can read this
 * without being taught twice.
 */
const ShowcaseTile = React.memo(function ShowcaseTile({
  photo,
  width,
  onPress,
}: {
  photo: Photo;
  /**
   * Measured, not a percentage. A wrapping flex row with a `gap` cannot hold two 50%
   * children — the gap pushes the second onto its own line — so the width is computed
   * from the window once and handed down.
   */
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${photo.catNickname}, scored ${photo.scores.total}, ${photo.tier}`}
      style={[styles.showcaseTile, { width }]}
    >
      <Image
        source={photo.imageUrl || undefined}
        contentFit="cover"
        transition={200}
        style={StyleSheet.absoluteFill}
        accessible={false}
      />
      <View style={styles.showcaseCorners} pointerEvents="none">
        <ScoreChip score={photo.scores.total} />
        <RarityBadge rarity={photo.tier} size="sm" compact />
      </View>
    </Pressable>
  );
});

const Milestone = React.memo(function Milestone({
  label,
  detail,
  achieved,
}: {
  label: string;
  detail: string;
  achieved: boolean;
}) {
  const Glyph = achieved ? CheckCircle : Circle;

  return (
    <View style={styles.milestone}>
      <Glyph
        size={icon.size.md}
        color={achieved ? marmalade[600] : paper.textFaint}
        weight={achieved ? icon.weightActive : icon.weightDefault}
      />
      <View style={styles.milestoneBody}>
        <Text style={[text.body, { color: achieved ? paper.text : paper.textMuted }]}>
          {label}
        </Text>
        <Text style={[text.caption, { color: paper.textFaint }]}>{detail}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  headBody: {
    flex: 1,
    gap: 6,
  },
  rankPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.full,
    backgroundColor: marmalade[100],
  },
  rankPillText: {
    color: marmalade[600],
    flexShrink: 1,
  },
  proBadge: {
    marginTop: spacing.xxs,
  },
  statRail: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: paper.hairline,
  },
  railCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  railDivider: {
    borderLeftWidth: 1,
    borderLeftColor: paper.hairline,
  },
  railLabel: {
    color: paper.textSubtle,
  },
  showcase: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.gridGap,
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
  showcaseCorners: {
    position: 'absolute',
    top: 7,
    left: 7,
    right: 7,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
    marginTop: spacing.xl,
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
  milestone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  milestoneBody: {
    flex: 1,
    gap: 1,
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
