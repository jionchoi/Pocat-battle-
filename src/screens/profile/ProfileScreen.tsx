import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CheckCircle, Circle } from 'phosphor-react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Avatar } from '../../components/Avatar';
import { Badge, RarityBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { MeterBar } from '../../components/ProgressBar';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { RARITIES, rankProgress, rankTitle } from '../../constants/game';
import type { Rarity } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { bone, fern, icon, radii, spacing, text } from '../../theme';
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
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  const photos = useAlbumStore((s) => s.photos);
  const cats = useAlbumStore((s) => s.cats);
  const load = useAlbumStore((s) => s.load);
  const loadCatDex = useAlbumStore((s) => s.loadCatDex);

  useEffect(() => {
    void refreshUser();
    void load();
    void loadCatDex();
  }, [load, loadCatDex, refreshUser]);

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

  // Reachable for a beat between hydrate and the first `me` response.
  if (!user) {
    return (
      <Screen>
        <ScreenHeader title="Profile" />
      </Screen>
    );
  }

  const quotaRatio =
    user.photoLimit === null ? 0 : Math.min(1, user.photoCount / user.photoLimit);
  const nearingQuota = user.photoLimit !== null && quotaRatio >= 0.85;

  return (
    <Screen scroll>
      <ScreenHeader
        title="Profile"
        right={
          <View style={styles.headerActions}>
            <Button
              label="Shop"
              onPress={() => navigation.navigate('Shop')}
              variant="ghost"
            />
            <Button
              label="Settings"
              onPress={() => navigation.navigate('Settings')}
              variant="ghost"
            />
          </View>
        }
      />

      <View style={styles.head}>
        <Avatar uri={user.avatarUrl} name={user.username} size={76} />

        <View style={styles.headBody}>
          <Text style={[text.h1, { color: bone.text }]} numberOfLines={1}>
            {user.username}
          </Text>
          <Text style={[text.bodySm, { color: bone.textMuted }]}>
            {`Joined ${relativeTime(user.createdAt)}`}
          </Text>
          {user.proSubscriptionActive ? (
            <Badge label="Pro" tone="accent" style={styles.proBadge} />
          ) : null}
        </View>
      </View>

      {/* Rank is the one progression bar in the app, and it buys cosmetics only. */}
      <Card style={styles.rankCard}>
        <View style={styles.rankRow}>
          <View>
            <Text style={[text.caption, { color: bone.textMuted }]}>
              {`Rank ${user.photographerRank}`}
            </Text>
            <Text style={[text.h2, { color: bone.text }]}>
              {rankTitle(user.photographerRank)}
            </Text>
          </View>
          <Text style={[text.stat, { color: bone.textMuted }]}>
            {compactNumber(user.photographerXp)}
          </Text>
        </View>

        <MeterBar
          ratio={rankProgress(user.photographerXp, user.photographerRank)}
          style={styles.rankMeter}
        />

        <Text style={[text.caption, { color: bone.textFaint }]}>
          {user.xpToNextRank > 0
            ? `${compactNumber(user.xpToNextRank)} XP to the next rank. Rank comes mostly from how people react to your photos — share them to climb. It unlocks filters and frames, never a scoring advantage.`
            : 'Top rank reached.'}
        </Text>
      </Card>

      <View style={styles.stats}>
        <StatHeadline label="Photos" value={user.photoCount} />
        <StatHeadline label="Cats known" value={cats.length} />
        <StatHeadline label="Discovered" value={discovered} />
        <StatHeadline label="Reactions" value={user.votesReceived} />
      </View>

      {/* Album quota, and the Pro upsell trigger (README 5.7). Only shown as it starts
          to matter — a full-width upsell at 3 photos would be noise. */}
      {user.photoLimit !== null ? (
        <Card style={styles.quota}>
          <MeterBar
            ratio={quotaRatio}
            label="Album storage"
            valueLabel={`${user.photoCount} / ${user.photoLimit}`}
            color={nearingQuota ? undefined : fern[600]}
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

      {best ? (
        <>
          <SectionHeader title="Your best shot" />
          <Card>
            <View style={styles.bestRow}>
              <View style={styles.bestBody}>
                <Text style={[text.h3, { color: bone.text }]}>{best.catNickname}</Text>
                <Text style={[text.caption, { color: bone.textMuted }]}>
                  {best.badges.length > 0 ? best.badges.join(' · ') : best.tier}
                </Text>
              </View>
              <StatHeadline label="Score" value={best.scores.total} />
            </View>

            <Button
              label="Open the photo"
              onPress={() =>
                navigation.navigate('AlbumTab', {
                  screen: 'PhotoDetail',
                  params: { photoId: best.id },
                })
              }
              variant="secondary"
              fullWidth
              style={styles.bestAction}
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const StatHeadline = React.memo(function StatHeadline({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[text.statLg, { color: bone.text }]}>{compactNumber(value)}</Text>
      <Text style={[text.caption, { color: bone.textMuted }]}>{label}</Text>
    </View>
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
        color={achieved ? fern[600] : bone.textFaint}
        weight={achieved ? icon.weightActive : icon.weightDefault}
      />
      <View style={styles.milestoneBody}>
        <Text style={[text.body, { color: achieved ? bone.text : bone.textMuted }]}>
          {label}
        </Text>
        <Text style={[text.caption, { color: bone.textFaint }]}>{detail}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headBody: {
    flex: 1,
    gap: 2,
  },
  proBadge: {
    marginTop: spacing.xxs,
  },
  rankCard: {
    marginTop: spacing.lg,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  rankMeter: {
    marginBottom: spacing.xs,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xl,
    marginTop: spacing.lg,
  },
  stat: {
    gap: 1,
  },
  quota: {
    marginTop: spacing.lg,
  },
  quotaBody: {
    color: bone.textMuted,
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
    backgroundColor: bone.sunken,
    overflow: 'hidden',
  },
  tierBarFill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: fern[600],
  },
  tierCount: {
    minWidth: 28,
    textAlign: 'right',
    color: bone.textMuted,
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
