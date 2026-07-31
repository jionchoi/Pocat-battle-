import React, { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { SCORE_LABELS } from '../constants/game';
import type { PhotoScores, PoseClass, Rarity } from '../models';
import {
  contextColors,
  fern,
  perpetual,
  poseLabel,
  radii,
  rarity as rarityTokens,
  semantic,
  spacing,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';
import { ScoreMeter } from './ProgressBar';

/**
 * ScoreBreakdown — the mini report card (README section 6).
 *
 * Shown on the Score Result screen and on Photo Detail. On the reveal it tallies:
 * the four components fill in sequence, then the total counts up. On Photo Detail the
 * same component renders its end state immediately, because a player re-opening an old
 * photo does not want to sit through the animation again.
 *
 * The pose row names the detected pose rather than showing a bare number. "Mid-yawn 84"
 * tells the player what earned the score; "84" alone teaches them nothing about how to
 * shoot better next time, which is the whole point of showing a breakdown.
 */

export interface ScoreBreakdownProps {
  scores: PhotoScores;
  pose: PoseClass;
  tier: Rarity;
  badges: string[];
  /** Animate the tally. False on Photo Detail, where the result is already known. */
  animate?: boolean;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}

const ROW_STAGGER_MS = 120;

export const ScoreBreakdown = React.memo(function ScoreBreakdown({
  scores,
  pose,
  tier,
  badges,
  animate = false,
  context = 'bone',
  style,
}: ScoreBreakdownProps) {
  const c = contextColors(context);
  const spec = rarityTokens[tier];

  return (
    <View style={style}>
      <View style={styles.rows}>
        <ScoreMeter
          label={SCORE_LABELS.composition}
          value={scores.composition}
          context={context}
          animate={animate}
          delayMs={0}
        />
        <ScoreMeter
          label={`${SCORE_LABELS.poseRarity} · ${poseLabel[pose]}`}
          value={scores.poseRarity}
          context={context}
          animate={animate}
          delayMs={ROW_STAGGER_MS}
        />
        <ScoreMeter
          label={SCORE_LABELS.catRarity}
          value={scores.catRarity}
          context={context}
          animate={animate}
          delayMs={ROW_STAGGER_MS * 2}
        />

        {/* Bonus is additive and small, so it is a line rather than a meter — a 6/100
            bar next to three near-full ones would read as a failure. */}
        {scores.bonus > 0 ? (
          <View style={styles.bonusRow}>
            <Text style={[text.bodySm, { color: c.textMuted }]}>{SCORE_LABELS.bonus}</Text>
            <Text style={[text.stat, { color: semantic.success }]}>{`+${scores.bonus}`}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.totalRow, { borderTopColor: c.hairline }]}>
        <View>
          <Text style={[text.caption, { color: c.textMuted }]}>Total</Text>
          <Text style={[text.bodySm, { color: spec.label }]}>{tier}</Text>
        </View>

        <TotalValue total={scores.total} animate={animate} context={context} />
      </View>

      {badges.length > 0 ? (
        <View style={styles.badges}>
          {badges.map((badge) => (
            <View
              key={badge}
              style={[styles.badge, { backgroundColor: fern[100], borderColor: spec.ring }]}
            >
              <Text style={[text.caption, { color: fern[700] }]}>{badge}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

/**
 * The total, counting up on reveal.
 *
 * Rendered into an uneditable `TextInput` driven by `useAnimatedProps`, which is the one
 * way to change displayed text from the UI thread — a `<Text>` can only be updated by
 * pushing state from JS, and a 60fps setState loop on the reveal screen is exactly what
 * makes the animation stutter on the device where it matters.
 */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const TotalValue = React.memo(function TotalValue({
  total,
  animate,
  context,
}: {
  total: number;
  animate: boolean;
  context: ContextName;
}) {
  const c = contextColors(context);
  const reduceMotion = useReduceMotion();

  const value = useSharedValue(animate && !reduceMotion ? 0 : total);
  const pop = useSharedValue(animate && !reduceMotion ? 0.9 : 1);

  useEffect(() => {
    if (!animate || reduceMotion) {
      value.value = total;
      pop.value = 1;
      return;
    }

    const delay = ROW_STAGGER_MS * 3 + 220;

    value.value = withDelay(
      delay,
      withTiming(total, {
        duration: perpetual.scoreTally.duration,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
      })
    );

    pop.value = withDelay(
      delay + perpetual.scoreTally.duration,
      withTiming(1, { duration: 260, easing: Easing.bezier(0.32, 0.72, 0, 1) })
    );
  }, [animate, pop, reduceMotion, total, value]);

  // `text` is not a public TextInput prop, but it is the native property Reanimated
  // writes to drive displayed text from the UI thread. The cast through `never` is the
  // documented cost of that — there is no typed alternative.
  const animatedProps = useAnimatedProps(
    () => ({ text: String(Math.round(value.value)) }) as never
  );

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
  }));

  return (
    <Animated.View style={animated}>
      <AnimatedTextInput
        editable={false}
        // A screen reader should announce the final score, not whatever frame the
        // animation happens to be on.
        accessibilityLabel={`Total score ${total}`}
        defaultValue={String(animate && !reduceMotion ? 0 : total)}
        animatedProps={animatedProps}
        style={[text.statLg, styles.total, { color: c.text }]}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  rows: {
    gap: spacing.sm,
  },
  bonusRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  totalRow: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  total: {
    textAlign: 'right',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
});
