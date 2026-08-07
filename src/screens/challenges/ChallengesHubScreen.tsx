import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { Trophy } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { challengeApi, socialApi } from '../../api/endpoints';
import { Button } from '../../components/Button';
import {
  ChallengeHero,
  ChallengeLeaderCard,
  PastChallengeRow,
  StreakPill,
} from '../../components/ChallengeBanner';
import { DividedGroup } from '../../components/Card';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { AchievementRows } from '../../components/AchievementRows';
import { pawRefreshControl } from '../../components/PawRefresh';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { SkeletonBlock, SkeletonList } from '../../components/Skeleton';
import { useAchievements } from '../../hooks/useAchievements';
import type { Challenge, ChallengeLeader, LeaderboardEntry } from '../../models';
import {
  marmalade,
  paper,
  radii,
  spacing,
  spring,
  staggerDelay,
  text,
  useReduceMotion,
} from '../../theme';
import type { ChallengesStackParamList } from '../../navigation/types';

/**
 * Challenges hub (README section 5.4).
 *
 * ## One headline, then a list
 *
 * The first live challenge is the hero and the rest are goal rows. That split is the
 * screen's whole argument: a player opening this tab is deciding *what to go and shoot*,
 * and three equally-weighted cards make that a comparison instead of an instruction. The
 * hero is picked by position rather than by a flag — the server already returns `active`
 * in the order it wants them shown, and a second source of truth for "which is the big
 * one" is a bug waiting to happen.
 *
 * ## The leaderboard is shown, not linked to
 *
 * The community feed and the friends list have moved to the map, which is where the other
 * players already are. The leaderboard stayed, because standings are the *result* of the
 * challenges above them — but it stayed as a board rather than as a button. A row of
 * secondary buttons labelled "Leaderboard" asks the player to take it on faith that there
 * is something worth a tap behind it; five lines of rank, name and score answer it.
 *
 * The preview is deliberately plain text. The photographs, the tiers and the podium are on
 * the full board behind "See all", where there is room to look at them; five lines here
 * answer the only question a preview is for — am I on this, and by how much.
 *
 * One number: **best score**. Every player already has a best shot, the same figure is on
 * their own profile, and "highest score wins" is a rule you can state in three words and
 * check yourself.
 *
 * ## Four bands, not eight cards
 *
 * The page is the hero, one list, the board, and the archive. Goals and achievements were
 * two bands asking the same question — how far along are you — so they are one set now,
 * defined once in the achievement tree; and each band springs in behind the one above it
 * rather than the whole page appearing at once. What is left is four things a player can
 * name, which is what the screen was short of when it was a column of similar boxes.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'ChallengesHub'>;

/**
 * Five rows, which is also the floor the server clamps `limit` to — a top five is a
 * podium you can take in at a glance, and a longer one turns the hub into the board.
 */
const BOARD_ROWS = 5;

/**
 * What the hero actually measures: two chip rows, a 44pt glyph tile beside two lines of
 * title and prompt, and a footer, inside `spacing.lg` padding. Worth keeping close — a
 * skeleton that is the wrong height moves the whole page when the real card lands.
 */
const HERO_HEIGHT = 236;

export function ChallengesHubScreen({ navigation }: Props) {
  const achievements = useAchievements();

  const [active, setActive] = useState<Challenge[]>([]);
  const [past, setPast] = useState<Challenge[]>([]);
  const [leader, setLeader] = useState<ChallengeLeader | null>(null);
  const [streakDays, setStreakDays] = useState<number | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  /**
   * Two spinners, because there are two requests.
   *
   * They used to share one flag cleared after `Promise.allSettled`, which meant the hero —
   * the reason the screen exists — sat behind a skeleton until the leaderboard snapshot
   * came back. One slow query held up the whole page. Each half now clears its own.
   */
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Two requests, settled independently.
   *
   * A leaderboard snapshot that has not been computed for this neighbourhood yet is an
   * ordinary state, not a broken screen — letting it reject into the same `catch` as the
   * challenges would replace the hero with "we could not load this week's challenges"
   * because a preview at the bottom of the page failed.
   */
  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    setBoardLoading(true);

    // Fired together, awaited apart: whichever lands first paints first.
    const challenges = challengeApi.active().then(
      (result) => {
        setActive(result.active);
        setPast(result.past);
        setLeader(result.leader ?? null);
        setStreakDays(result.streakDays ?? null);
      },
      () => setError('We could not load this week’s challenges.')
    );

    const leaderboard = socialApi
      .leaderboard({ scope: 'neighborhood', metric: 'topPhoto', limit: BOARD_ROWS })
      .then(
        (result) => setBoard(result.entries),
        () => setBoard([])
      );

    void challenges.finally(() => setLoading(false));
    void leaderboard.finally(() => setBoardLoading(false));

    // The pull-to-refresh spinner belongs to the gesture, so it waits for both.
    await Promise.allSettled([challenges, leaderboard]);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEntries = useCallback(
    (challenge: Challenge) =>
      navigation.navigate('ChallengeEntries', {
        challengeId: challenge.id,
        title: challenge.title,
      }),
    [navigation]
  );

  const openSubmission = useCallback(
    (challenge: Challenge) =>
      navigation.navigate('ChallengeSubmission', {
        challengeId: challenge.id,
        title: challenge.title,
      }),
    [navigation]
  );

  /**
   * A closed challenge has nothing left to enter, so it opens its results instead. The
   * hero is one target either way — the destination is what changes, not the affordance.
   */
  const openChallenge = useCallback(
    (challenge: Challenge) =>
      challenge.status === 'closed' ? openEntries(challenge) : openSubmission(challenge),
    [openEntries, openSubmission]
  );

  const [headline, ...rest] = active;

  return (
    <Screen
      scroll
      refreshing={refreshing}
      refreshControl={pawRefreshControl({
        refreshing,
        onRefresh: () => void load(true),
      })}
    >
      <ScreenHeader
        title="Challenges"
        right={<StreakPill days={streakDays} />}
      />

      {error ? <InlineError message={error} onRetry={() => void load()} /> : null}

      {/* One block, the shape of the hero it stands in for. The second block under it used
          to stand in for a goal row that no longer exists, so the skeleton was promising a
          card that never arrived. */}
      {loading ? (
        <SkeletonBlock width="100%" height={HERO_HEIGHT} radius={radii.xxl} />
      ) : (
        <Band index={0}>
          {headline === undefined ? (
            <EmptyState
              title="No challenge running"
              body="A new prompt opens shortly. Your achievements below keep running either way."
              Glyph={Trophy}
            />
          ) : (
            <ChallengeHero challenge={headline} onPress={() => openChallenge(headline)} />
          )}

          {/*
            Normally empty — the rotation keeps one challenge open at a time. When a second
            one is running it gets a hero of its own rather than a goal row, because a
            challenge you cannot tap is a challenge you cannot enter.
          */}
          {rest.map((challenge) => (
            <ChallengeHero
              key={challenge.id}
              challenge={challenge}
              onPress={() => openChallenge(challenge)}
              style={styles.stackedHero}
            />
          ))}

          {leader && headline ? (
            <ChallengeLeaderCard
              leader={leader}
              onPress={() => openEntries(headline)}
              style={styles.leader}
            />
          ) : null}
        </Band>
      )}

      {/*
        Goals and achievements are one list — and now one set.

        Rarity Rookie, Golden Hour Streak and the Neighbourhood Census used to arrive here
        as server-computed goal rows and are achievements in their own right, so they are
        defined once, in the tree, and shown once, here. Rendering both would have put
        "Rarity Rookie" on this screen twice with two different meters under it.

        What is lost is the census being a *community* meter — 200 photographers in your
        bucket — which the device cannot compute. The achievement counts the census the
        player actually takes instead: how many different cats they have catalogued.
      */}
      <Band index={1}>
        <SectionHeader title="Active challenges" style={styles.section} />

        <DividedGroup>
          <AchievementRows
            achievements={achievements}
            onPress={() => navigation.navigate('Achievements')}
          />
        </DividedGroup>
      </Band>

      <Band index={2}>
        <SectionHeader
          title="Leaderboard"
          Glyph={Trophy}
          action={
            <Button
              label="See all"
              variant="ghost"
              onPress={() => navigation.navigate('Leaderboard')}
            />
          }
        />

        <Board
          entries={board}
          loading={boardLoading}
          onOpenProfile={(userId) => navigation.navigate('PublicProfile', { userId })}
        />
      </Band>

      {past.length > 0 ? (
        <Band index={3}>
          <SectionHeader title="Previous winners" />
          <DividedGroup>
            {past.map((challenge) => (
              <PastChallengeRow
                key={challenge.id}
                challenge={challenge}
                onPress={() => openEntries(challenge)}
              />
            ))}
          </DividedGroup>
        </Band>
      ) : null}
    </Screen>
  );
}

/**
 * A band of the page, arriving under its own weight.
 *
 * Nothing on this screen mounts statically: each band springs up and fades in behind the
 * one above it, `staggerDelay` apart. Transform and opacity only, on the UI thread, and
 * collapsed to its end state when reduce-motion is on — a player who asked for stillness
 * should not have to sit through a waterfall to read a leaderboard.
 *
 * It runs once, on mount, so refreshing the page does not replay it.
 */
const Band = React.memo(function Band({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = reduceMotion
      ? 1
      : withDelay(staggerDelay(index), withSpring(1, spring.soft));
  }, [enter, index, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 14 }],
  }));

  return <Animated.View style={animated}>{children}</Animated.View>;
});

/**
 * The top five, one line each: rank, who, score.
 *
 * A preview is a table of contents, not the board. Photographs and rarity crests belong on
 * the full screen where there is room to look at them; here the job is to answer "am I on
 * this, and by how much" in the height of five lines. Rank and score are tabular figures,
 * so the two columns stay ruler-straight as the numbers change.
 */
const Board = React.memo(function Board({
  entries,
  loading,
  onOpenProfile,
}: {
  entries: LeaderboardEntry[];
  loading: boolean;
  onOpenProfile: (userId: string) => void;
}) {
  if (loading) {
    // Row-shaped, and the same five of them the board will be — a single tall block
    // resolves into five lines and the whole section jumps as it lands.
    return <SkeletonList count={BOARD_ROWS} showAvatar={false} />;
  }

  if (entries.length === 0) {
    return (
      <Text style={[text.bodySm, styles.boardEmpty]}>
        No scores near you yet. The board fills in as more people shoot nearby.
      </Text>
    );
  }

  return (
    <DividedGroup>
      {entries.slice(0, BOARD_ROWS).map((entry) => (
        <Pressable
          key={entry.userId}
          onPress={() => onOpenProfile(entry.userId)}
          accessibilityRole="button"
          accessibilityLabel={`Rank ${entry.rank}, ${entry.username}, best score ${entry.value}${
            entry.isSelf ? ', you' : ''
          }`}
          style={styles.boardRow}
        >
          <Text style={[text.statSm, styles.boardRank]}>{entry.rank}</Text>

          <Text
            style={[
              text.bodySm,
              styles.boardName,
              { color: entry.isSelf ? marmalade[600] : paper.text },
            ]}
            numberOfLines={1}
          >
            {entry.username}
            {entry.isSelf ? ' · you' : ''}
          </Text>

          <Text style={[text.stat, { color: paper.text }]}>{entry.value}</Text>
        </Pressable>
      ))}
    </DividedGroup>
  );
});

const styles = StyleSheet.create({
  gap: {
    marginTop: spacing.md,
  },
  stackedHero: {
    marginTop: spacing.sm,
  },
  section: {
    marginTop: spacing.xl,
  },
  leader: {
    marginTop: spacing.md,
  },
  boardEmpty: {
    color: paper.textMuted,
  },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  /** Fixed width so five ranks form a column rather than a ragged left edge. */
  boardRank: {
    width: 18,
    color: paper.textFaint,
  },
  boardName: {
    flex: 1,
  },
});
