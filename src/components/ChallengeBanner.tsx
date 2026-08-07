import React, { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  ArrowRight,
  CaretRight,
  CheckCircle,
  CloudRain,
  Diamond,
  Fire,
  Medal,
  MoonStars,
  Sun,
  Timer,
  Trophy,
  UsersThree,
  type IconProps,
} from 'phosphor-react-native';

import type {
  Challenge,
  ChallengeGoal,
  ChallengeIconKey,
  ChallengeLeader,
  ChallengeProgress,
} from '../models';
import {
  chrome,
  contextColors,
  lagoon,
  marmalade,
  paper,
  radii,
  rarity as rarityTokens,
  semantic,
  spacing,
  text,
  type ContextName,
} from '../theme';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { MeterBar } from './ProgressBar';
import { compactNumber, remainingLabel } from '../utils/format';

/**
 * The Challenges hub's surfaces (README §6).
 *
 * One loud thing and a quiet list under it. `ChallengeHero` is the week's headline prompt
 * rendered as a coral field — the only saturated block of chrome in the product, and it
 * earns that by being the one screen where the app is asking the player to go and do
 * something specific. Everything below it is neutral: goal rows on a soft well, and a
 * leader line on a hairline card.
 *
 * ## Everything optional degrades one element at a time
 *
 * The hero draws a progress meter and a reward line, and the server may send neither. Each
 * is independently conditional, so a challenge carrying only a title and an end date
 * renders as a clean card rather than as a skeleton of empty slots.
 */

/* -------------------------------------------------------------------------- */
/* Glyphs                                                                     */
/* -------------------------------------------------------------------------- */

const CHALLENGE_GLYPHS: Record<ChallengeIconKey, React.ComponentType<IconProps>> = {
  rain: CloudRain,
  sun: Sun,
  night: MoonStars,
  rarity: Diamond,
  community: UsersThree,
  trophy: Trophy,
};

/**
 * The accent a goal row wears.
 *
 * Borrowed from the rarity ramp and the semantic set rather than invented, so the hub
 * introduces no new hues. These sit on neutral chrome and are never interactive — the
 * coral accent stays the only thing on this screen that means "tap me".
 */
const GOAL_ACCENTS: Record<ChallengeIconKey, string> = {
  rain: rarityTokens.Rare.base,
  sun: semantic.warning,
  night: rarityTokens.Epic.base,
  rarity: rarityTokens.Rare.base,
  community: paper.text,
  trophy: semantic.warning,
};

function glyphFor(icon: ChallengeIconKey | null | undefined) {
  return CHALLENGE_GLYPHS[icon ?? 'trophy'] ?? Trophy;
}

function accentFor(icon: ChallengeIconKey | null | undefined) {
  return GOAL_ACCENTS[icon ?? 'trophy'] ?? paper.text;
}

/** `current / target`, clamped and safe when the server sends a zero target. */
function ratioOf(progress: ChallengeProgress): number {
  if (progress.target <= 0) return 0;
  return Math.max(0, Math.min(1, progress.current / progress.target));
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Segmented progress, not a continuous bar.
 *
 * The hero's goal is a small whole number — three of five shots — and a smooth bar at 60%
 * makes a countable thing look measured. Pips are the count, so "two to go" is readable
 * without reading the label. Above `MAX_PIPS` it falls back to a solid bar, because
 * twenty slivers is not a count either.
 */
const MAX_PIPS = 8;

const HeroProgress = React.memo(function HeroProgress({
  progress,
}: {
  progress: ChallengeProgress;
}) {
  const ratio = ratioOf(progress);
  const pct = Math.round(ratio * 100);
  const usePips = progress.target > 0 && progress.target <= MAX_PIPS;

  return (
    <View style={styles.heroProgress}>
      <View style={styles.heroProgressLabels}>
        <Text style={[text.h3, styles.onField]}>
          {`${progress.current} of ${progress.target} ${progress.unit}`}
        </Text>
        <Text style={[text.h3, styles.onField]}>{`${pct}%`}</Text>
      </View>

      {usePips ? (
        <View
          style={styles.pips}
          accessibilityRole="progressbar"
          accessibilityValue={{ now: progress.current, min: 0, max: progress.target }}
        >
          {Array.from({ length: progress.target }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.pip,
                {
                  backgroundColor:
                    i < progress.current ? chrome.text : 'rgba(255,255,255,0.28)',
                },
              ]}
            />
          ))}
        </View>
      ) : (
        <MeterBar
          ratio={ratio}
          color={chrome.text}
          trackColor="rgba(255,255,255,0.28)"
          height={10}
        />
      )}
    </View>
  );
});

/**
 * The hero's field, and the desaturated version a finished challenge wears.
 *
 * Lagoon, not coral. The hub had become a single hue top to bottom — a coral hero over
 * coral achievement tiles over coral meters over a coral link — and at that point the
 * accent had stopped meaning anything, because everything was the accent. The weekly
 * challenge is the one object on the page that is not a progress row, so it is the one
 * that changes colour: the secondary says "different kind of thing", and coral goes back
 * to marking the things you press.
 */
const HERO_FIELD = {
  open: { base: lagoon[600], from: lagoon[500], to: lagoon[700] },
  closed: { base: '#6E6E75', from: '#7A7A80', to: '#5A5A60' },
} as const;

/**
 * The week's prompt.
 *
 * The whole card is the target rather than a button inside it: there is exactly one thing
 * to do with a live challenge, and a 340pt card with a 44pt button in the corner wastes
 * the other 296pt. The trailing arrow is the affordance, and a closed challenge points at
 * its results instead.
 *
 * ## The field is a solid fill with a gradient laid over it
 *
 * RN has no CSS gradient and the project carries no gradient package, so the ramp is an
 * SVG rect. `Svg` will not paint without real dimensions, though — a percentage rect
 * inside an auto-sized `Svg` resolves against nothing and the card comes out empty, which
 * on a white page means white text on white. So the card owns a solid coral background
 * that is correct on its own, and the gradient is an enhancement drawn once `onLayout`
 * has reported a size. First paint is right, and a failed SVG is invisible rather than
 * catastrophic.
 */
export const ChallengeHero = React.memo(function ChallengeHero({
  challenge,
  onPress,
  style,
}: {
  challenge: Challenge;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const closed = challenge.status === 'closed';
  const entered = challenge.mySubmissionPhotoId !== null;
  const Glyph = glyphFor(challenge.icon);
  const field = closed ? HERO_FIELD.closed : HERO_FIELD.open;
  const gradientId = `challenge-hero-${closed ? 'closed' : 'open'}`;

  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // Guarded so a re-layout at the same size does not loop through state.
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);

  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={
        closed
          ? `${challenge.title}, closed. See the results.`
          : `${challenge.title}. ${entered ? 'You have entered. Change your photo.' : 'Enter a photo.'}`
      }
      style={[styles.hero, { backgroundColor: field.base }, style]}
    >
      {size.width > 0 ? (
        <Svg
          width={size.width}
          height={size.height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            {/*
              Gradient ids are global to the SVG renderer, so two heroes on screen at once
              would share whichever registered last. Keying by state makes the collision
              harmless — the only ids that can collide are identical. Same fix as Grain.
            */}
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0.55" y2="1">
              <Stop offset="0" stopColor={field.from} />
              <Stop offset="1" stopColor={field.to} />
            </LinearGradient>
          </Defs>
          <Rect width={size.width} height={size.height} fill={`url(#${gradientId})`} />
        </Svg>
      ) : null}

      {/* Two soft discs breaking the flat field. Clipped by the card's overflow. */}
      <View pointerEvents="none" style={[styles.orb, styles.orbTop]} />
      <View pointerEvents="none" style={[styles.orb, styles.orbBottom]} />

      <View style={styles.heroTopRow}>
        {/*
          The eyebrow always names the surface. It used to swap to "Entered", which read as
          the card changing identity when all that changed was your relationship to it —
          that state belongs on the footer, next to the action it modifies.
        */}
        <View style={styles.heroChipLight}>
          <Trophy size={11} weight="fill" color={chrome.text} />
          <Text style={[text.eyebrow, styles.heroChipEyebrow]}>
            {closed ? 'Closed' : 'Weekly challenge'}
          </Text>
        </View>

        <View style={styles.heroChipDark}>
          <Timer size={12} weight="bold" color={chrome.text} />
          <Text style={[text.caption, styles.onField]}>
            {closed ? 'Results are in' : remainingLabel(challenge.endsAt)}
          </Text>
        </View>
      </View>

      <View style={styles.heroTitleRow}>
        <View style={styles.heroTile}>
          <Glyph size={22} weight="fill" color={chrome.text} />
        </View>
        <View style={styles.heroTitleText}>
          <Text style={[text.h2, styles.onField]} numberOfLines={2}>
            {challenge.title}
          </Text>
          {/*
            The prompt itself, not a marketing line about it. This is the sentence that
            tells the player what to go and photograph, which is the only thing the hero
            has to communicate.
          */}
          <Text style={[text.bodySm, styles.onFieldMuted]} numberOfLines={2}>
            {challenge.prompt}
          </Text>
        </View>
      </View>

      {challenge.progress ? <HeroProgress progress={challenge.progress} /> : null}

      <View style={styles.heroFooter}>
        <View style={styles.heroFooterLeft}>
          {entered && !closed ? (
            <>
              <CheckCircle size={15} weight="fill" color={chrome.text} />
              <Text style={[text.caption, styles.onField]} numberOfLines={1}>
                Entered · tap to change your photo
              </Text>
            </>
          ) : challenge.reward ? (
            <>
              <Medal size={15} weight="fill" color={chrome.text} />
              <Text style={[text.caption, styles.onField]} numberOfLines={1}>
                {`Reward: ${challenge.reward}`}
              </Text>
            </>
          ) : (
            <>
              <Trophy size={15} weight="fill" color={chrome.text} />
              <Text style={[text.caption, styles.onField]} numberOfLines={1}>
                {challenge.judging === 'votes'
                  ? 'Winner decided by reactions'
                  : 'Winner decided by photo score'}
              </Text>
            </>
          )}
        </View>
        <ArrowRight size={15} weight="bold" color={chrome.text} />
      </View>
    </Pressable>
  );
});

/* -------------------------------------------------------------------------- */
/* Goal row                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One standing goal: a tinted glyph tile, what it asks, and how far along you are.
 *
 * Not pressable. There is nothing behind a goal to open — it is a count of work already
 * done, not a prompt to enter — and a row that highlights under the thumb and then does
 * nothing is worse than a row that plainly does not.
 *
 * The value on the right is a count for a personal goal and a percentage for a community
 * one. "62%" is the honest reading of a target 128 people are pushing on; "128/200" reads
 * as though the player owns all 128.
 */
export const ChallengeGoalRow = React.memo(function ChallengeGoalRow({
  goal,
  style,
}: {
  goal: ChallengeGoal;
  style?: StyleProp<ViewStyle>;
}) {
  const Glyph = glyphFor(goal.icon);
  const accent = accentFor(goal.icon);
  const ratio = ratioOf(goal.progress);

  const value =
    goal.kind === 'community'
      ? `${Math.round(ratio * 100)}%`
      : `${goal.progress.current}/${goal.progress.target}`;

  return (
    <View
      accessible
      accessibilityLabel={`${goal.title}. ${goal.description}. ${value}.`}
      style={[styles.goalRow, style]}
    >
      <View style={styles.goalHead}>
        <View style={[styles.goalTile, { backgroundColor: `${accent}1F` }]}>
          <Glyph size={17} weight="fill" color={accent} />
        </View>

        <View style={styles.goalText}>
          <Text style={[text.h3, { color: paper.text }]} numberOfLines={1}>
            {goal.title}
          </Text>
          <Text style={[text.captionSm, styles.goalSub]} numberOfLines={1}>
            {goal.description}
          </Text>
        </View>

        <Text style={[text.stat, { color: paper.text }]}>{value}</Text>
      </View>

      <MeterBar
        ratio={ratio}
        color={accent}
        trackColor={paper.hairlineHi}
        height={6}
        style={styles.goalMeter}
      />
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Leader                                                                     */
/* -------------------------------------------------------------------------- */

/** Who is winning, and the two numbers that say why. Taps through to the entries. */
export const ChallengeLeaderCard = React.memo(function ChallengeLeaderCard({
  leader,
  onPress,
  style,
}: {
  leader: ChallengeLeader;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${leader.user.username} is leading this week. See the entries.`}
      style={[styles.leader, style]}
    >
      <Avatar uri={leader.user.avatarUrl} name={leader.user.username} size={34} />

      <View style={styles.leaderText}>
        <Text style={[text.bodySm, styles.leaderName]} numberOfLines={1}>
          {`@${leader.user.username} is leading this week`}
        </Text>
        <Text style={[text.captionSm, styles.goalSub]} numberOfLines={1}>
          {`${leader.qualifyingShots} qualifying ${
            leader.qualifyingShots === 1 ? 'shot' : 'shots'
          } · ${compactNumber(leader.reactions)} reactions`}
        </Text>
      </View>

      <CaretRight size={14} weight="bold" color={paper.textFaint} />
    </Pressable>
  );
});

/* -------------------------------------------------------------------------- */
/* Streak                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The capture streak, riding beside the screen title.
 *
 * Renders nothing below two days. A "1 day streak" is not a streak, and a pill that
 * appears the moment you open the app for the first time cheapens the one that shows up
 * at twelve.
 */
export const StreakPill = React.memo(function StreakPill({
  days,
}: {
  days: number | null | undefined;
}) {
  if (!days || days < 2) return null;

  return (
    <View style={styles.streak} accessibilityLabel={`${days} day streak`}>
      <Fire size={13} weight="fill" color={marmalade[600]} />
      <Text style={[text.caption, styles.streakLabel]}>{`${days} day streak`}</Text>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Past challenges                                                            */
/* -------------------------------------------------------------------------- */

/** Compact past-challenge row for the winners rail. */
export const PastChallengeRow = React.memo(function PastChallengeRow({
  challenge,
  onPress,
  context = 'paper',
}: {
  challenge: Challenge;
  onPress: () => void;
  context?: ContextName;
}) {
  const c = contextColors(context);
  const winner = challenge.winningPhoto;

  return (
    <View style={styles.pastRow}>
      <View style={styles.pastText}>
        <Text style={[text.bodySm, { color: c.text }]} numberOfLines={1}>
          {challenge.title}
        </Text>
        <Text style={[text.caption, { color: c.textMuted }]} numberOfLines={1}>
          {winner
            ? `Won by ${winner.author.username} with ${winner.scores.total}`
            : 'No winner — too few entries'}
        </Text>
      </View>

      <Button label="View" variant="ghost" onPress={onPress} />
    </View>
  );
});

const styles = StyleSheet.create({
  /* ---------------------------------- hero --------------------------------- */
  hero: {
    borderRadius: radii.xxl,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  /**
   * Decorative discs. Sized well beyond the card and pushed past its corners, so what
   * shows is an arc rather than a circle sitting on the artwork.
   */
  orb: {
    position: 'absolute',
    borderRadius: radii.full,
  },
  orbTop: {
    top: -30,
    right: -30,
    width: 140,
    height: 140,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  orbBottom: {
    bottom: -50,
    left: -20,
    width: 120,
    height: 120,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  heroChipLight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  heroChipDark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radii.full,
    backgroundColor: 'rgba(11,11,12,0.18)',
  },
  heroChipEyebrow: {
    color: chrome.text,
    fontSize: 10,
    letterSpacing: 0.9,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  heroTile: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitleText: {
    flex: 1,
    gap: spacing.xxs,
  },
  onField: {
    color: chrome.text,
  },
  onFieldMuted: {
    color: 'rgba(255,255,255,0.85)',
  },
  heroProgress: {
    marginTop: spacing.md,
  },
  heroProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  pips: {
    flexDirection: 'row',
    gap: 5,
  },
  pip: {
    flex: 1,
    height: 10,
    borderRadius: radii.full,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.25)',
  },
  heroFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },

  /* -------------------------------- goal row ------------------------------- */
  goalRow: {
    borderRadius: radii.lg,
    backgroundColor: paper.sunkenSoft,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  goalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  goalTile: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalText: {
    flex: 1,
    gap: 2,
  },
  goalSub: {
    color: paper.textFaint,
  },
  goalMeter: {
    marginTop: 10,
  },

  /* --------------------------------- leader -------------------------------- */
  leader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: paper.hairline,
    backgroundColor: paper.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  leaderText: {
    flex: 1,
    gap: 2,
  },
  leaderName: {
    color: paper.text,
  },

  /* --------------------------------- streak -------------------------------- */
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: marmalade[100],
  },
  streakLabel: {
    color: marmalade[600],
  },

  /* ---------------------------------- past --------------------------------- */
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  pastText: {
    flex: 1,
    gap: 1,
  },
});
