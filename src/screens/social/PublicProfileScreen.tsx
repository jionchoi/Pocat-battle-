import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { UserCircle } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { socialApi } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { PhotoCard } from '../../components/PhotoCard';
import { RankChip } from '../../components/LeaderboardRow';
import { Screen, SectionHeader } from '../../components/Screen';
import { SkeletonBlock } from '../../components/Skeleton';
import type { PublicProfile } from '../../models';
import { bone, layout, radii, spacing, text } from '../../theme';
import type { ChallengesStackParamList } from '../../navigation/types';
import { compactNumber, relativeTime } from '../../utils/format';

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

  const cardWidth = useMemo(
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

      <View style={styles.head}>
        <Avatar uri={profile.user.avatarUrl} name={profile.user.username} size={72} />

        <View style={styles.headBody}>
          <Text style={[text.h1, { color: bone.text }]} numberOfLines={1}>
            {profile.user.username}
          </Text>
          <Text style={[text.bodySm, { color: bone.textMuted }]}>
            {`Joined ${relativeTime(profile.user.createdAt)}`}
          </Text>
          {profile.user.proSubscriptionActive ? (
            <Badge label="Pro" tone="accent" style={styles.proBadge} />
          ) : null}
        </View>
      </View>

      <View style={styles.rank}>
        <RankChip rank={profile.user.photographerRank} />
      </View>

      {/* Stats as negative space and mono numerals — no boxes. Four numbers do not need
          four cards. */}
      <View style={styles.stats}>
        <StatHeadline label="Photos" value={profile.totalPhotos} />
        <StatHeadline label="Cats found" value={profile.catsDiscovered} />
        <StatHeadline label="Best shot" value={profile.bestScore} />
        <StatHeadline label="Challenge wins" value={profile.challengeWins} />
      </View>

      <SectionHeader
        title="Showcase"
        description="The shots they chose to show. Albums stay private."
      />

      {profile.showcasePhotos.length === 0 ? (
        <Card>
          <Text style={[text.body, { color: bone.textMuted }]}>Nothing on show yet.</Text>
        </Card>
      ) : (
        <View style={styles.grid}>
          {profile.showcasePhotos.map((photo, index) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              index={index}
              // A stranger's photo has no detail screen to open — the album it lives in
              // is private, so tapping does nothing here.
              onPress={() => undefined}
              style={{ width: cardWidth }}
            />
          ))}
        </View>
      )}
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

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  skeleton: {
    marginTop: spacing.sm,
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
  rank: {
    marginTop: spacing.md,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.gridGap,
  },
});
