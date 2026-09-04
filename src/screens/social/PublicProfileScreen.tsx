import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { UserCircle } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { socialApi } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { Badge, RarityBadge } from '../../components/Badge';
import { Card, DividedGroup } from '../../components/Card';
import { MeterBar } from '../../components/ProgressBar';
import {
  BoardTrophy,
  profileStyles,
  RankPill,
  ShowcaseTile,
  StatRail,
  TrophyCase,
  SHOWCASE_LIMIT,
} from '../../components/ProfileParts';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { BackButton, Screen, SectionHeader } from '../../components/Screen';
import { SkeletonBlock } from '../../components/Skeleton';
import { PLACEHOLDER_TROPHIES, SHOW_PLACEHOLDERS } from '../../constants/placeholders';
import { RARITIES, rankProgress, rankTitle } from '../../constants/game';
import { useBoardStanding } from '../../hooks/useBoardStanding';
import type { PublicProfile } from '../../models';
import { paper, layout, marmalade, radii, spacing, text } from '../../theme';
import type { ChallengesStackParamList } from '../../navigation/types';
import { compactNumber, pluralize, relativeTime } from '../../utils/format';

/**
 * Public Profile (README section 5.5).
 *
 * Deliberately partial: showcase photos and totals, nothing else. No capture locations —
 * a stranger's profile must not reveal which street a cat lives on, or where the
 * photographer walks. The server strips location from the public serializer rather than
 * trusting this screen to hide it.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'PublicProfile'>;

export function PublicProfileScreen({ navigation, route }: Props) {
  const { userId } = route.params;
  const { width } = useWindowDimensions();
  const standing = useBoardStanding(userId);

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await socialApi.publicProfile(userId);
      setProfile(result);
    } catch (err) {
      // A deep link can point at a deleted account. That is a not-found state with a way
      // out, not a retryable error.
      if (err instanceof Error && err.message.toLowerCase().includes('not exist')) {
        setMissing(true);
      } else {
        setError('We could not load that profile.');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const tileWidth = useMemo(
    () => (width - layout.gutter * 2 - layout.gridGap) / 2,
    [width]
  );

  if (missing) {
    return (
      <Screen>
        <EmptyState
          title="This photographer has moved on"
          body="That account no longer exists. Their photos were removed with it."
          Glyph={UserCircle}
          actionLabel="Go back"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  if (loading || !profile) {
    return (
      <Screen scroll>
        <SkeletonBlock width={72} height={72} radius={radii.xl} />
        <SkeletonBlock width="55%" height={24} style={styles.skeleton} />
        <SkeletonBlock width="35%" height={14} style={styles.skeleton} />
        <SkeletonBlock
          width="100%"
          height={200}
          radius={radii.xl}
          style={styles.skeleton}
        />
        {error ? (
          <InlineError message={error} onRetry={() => void fetchProfile()} />
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {error ? (
        <InlineError
          message={error}
          onRetry={() => void fetchProfile()}
          style={styles.banner}
        />
      ) : null}

      {/* This screen leads with an avatar rather than a title, so it cannot inherit its
          chevron from ScreenHeader. */}
      <BackButton style={styles.back} />

      <View style={profileStyles.head}>
        <Avatar uri={profile.user.avatarUrl} name={profile.user.username} size={64} />

        <View style={profileStyles.headBody}>
          <Text style={[text.h2, { color: paper.text }]} numberOfLines={1}>
            {profile.user.username}
          </Text>

          <RankPill rank={profile.user.photographerRank} />

          {profile.user.proSubscriptionActive ? (
            <Badge label="Pro" tone="accent" style={styles.proBadge} />
          ) : null}
        </View>
      </View>

      {/*
        The same rail, with the one figure that cannot be public swapped out. Reactions
        received is a number about how the crowd treats *you*; on a stranger's profile the
        equivalent question is what they have won, so challenge wins takes the slot.
      */}
      <StatRail
        stats={[
          { label: 'Photos', value: profile.totalPhotos },
          { label: 'Cats found', value: profile.catsDiscovered },
          { label: 'Best score', value: profile.bestScore },
          { label: 'Challenge wins', value: profile.challengeWins },
        ]}
      />

      {standing ? <BoardTrophy entry={standing} label="On the board" /> : null}

      {/*
        Their wins, above the showcase.

        Order is the argument: the showcase is what this photographer *chose* to put in front
        of you, and a win is what the field decided regardless of what they would have picked.
        The one that was not curated goes first.

        `challengeTrophies` is optional on the payload so a client running against an older
        server draws nothing here rather than throwing — see the note on the model.
      */}
      <TrophyCase
        trophies={
          profile.challengeTrophies?.length
            ? profile.challengeTrophies
            : SHOW_PLACEHOLDERS
              ? PLACEHOLDER_TROPHIES
              : []
        }
        onPress={(trophy) =>
          navigation.navigate('ChallengeEntries', {
            challengeId: trophy.challengeId,
            title: trophy.title,
          })
        }
      />

      <SectionHeader
        title="Showcase"
        description="The shots they chose to show. Albums stay private."
      />

      {profile.showcasePhotos.length === 0 ? (
        <Card>
          <Text style={[text.body, { color: paper.textMuted }]}>Nothing on show yet.</Text>
        </Card>
      ) : (
        <View style={profileStyles.showcase}>
          {profile.showcasePhotos.slice(0, SHOWCASE_LIMIT).map((photo) => (
            <ShowcaseTile key={photo.id} photo={photo} width={tileWidth} />
          ))}
        </View>
      )}

      {/*
        The shape of their album, not its contents. A stranger cannot browse somebody
        else's photographs — the rows are never sent — but how much they have shot and how
        it fell across the tiers is public the same way the stat rail is.

        Always rendered, including at zero. Hiding the section when nothing is shared made
        an empty profile and a broken one look identical, which is not a distinction to
        leave to the reader.
      */}
      <SectionHeader
        title="Album breakdown"
        description={
          profile.totalPhotos > 0
            ? pluralize(profile.totalPhotos, 'shared photo')
            : 'Nothing shared yet.'
        }
      />

      <Card>
        <DividedGroup>
          {RARITIES.map((tier) => {
            // `?? 0` guards a server that predates `tierCounts`: a missing field should
            // draw an empty bar, not take the screen down with it.
            const count = profile.tierCounts?.[tier] ?? 0;

            return (
              <View key={tier} style={styles.tierRow}>
                <RarityBadge rarity={tier} />
                <View style={styles.tierBarTrack}>
                  <View
                    style={[
                      styles.tierBarFill,
                      {
                        width: `${
                          profile.totalPhotos > 0
                            ? (count / profile.totalPhotos) * 100
                            : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[text.stat, styles.tierCount]}>{count}</Text>
              </View>
            );
          })}
        </DividedGroup>
      </Card>

      {/* Rank is the one progression bar in the app, and it buys cosmetics only — the same
          card your own profile carries, minus the XP-to-next line, which is yours alone. */}
      <SectionHeader
        title="Progress"
        description="Rank unlocks filters and frames. It never buys a scoring advantage."
      />

      <Card>
        <View style={styles.rankRow}>
          <Text style={[text.h3, { color: paper.text }]}>
            {rankTitle(profile.user.photographerRank)}
          </Text>
          <Text style={[text.stat, { color: paper.textMuted }]}>
            {compactNumber(profile.user.photographerXp)}
          </Text>
        </View>

        <MeterBar
          ratio={rankProgress(profile.user.photographerXp, profile.user.photographerRank)}
        />
      </Card>

      <Text style={[text.caption, styles.joined]}>
        {`Joined ${relativeTime(profile.user.createdAt)}`}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  skeleton: {
    marginTop: spacing.sm,
  },
  back: {
    marginBottom: spacing.xs,
  },
  proBadge: {
    marginTop: spacing.xxs,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  joined: {
    marginTop: spacing.lg,
    color: paper.textFaint,
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
});
