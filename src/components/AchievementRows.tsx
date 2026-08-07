import React, { useEffect, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { CaretRight, CheckCircle } from 'phosphor-react-native';

import { featuredAchievements, type Achievement } from '../constants/achievements';
import { marmalade, paper, radii, spacing, spring, text, useReduceMotion } from '../theme';

/**
 * Achievements, as rows rather than a card.
 *
 * They sit inside the hub's "Active challenges" list, directly under the weekly goals,
 * because the two are the same object: a thing with a target and a distance left to run.
 * Boxing the achievements separately drew a border between them and stated twice that the
 * player has work outstanding.
 *
 * Three entries, chosen by `featuredAchievements` — whatever is under way first, then
 * earned ones at random — and one row out to the tree.
 */
export const AchievementRows = React.memo(function AchievementRows({
  achievements,
  onPress,
  style,
}: {
  achievements: Achievement[];
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const featured = featuredAchievements(achievements);
  const earned = achievements.filter((a) => a.achieved).length;

  return (
    <View style={style}>
      {featured.map((entry) => (
        <Row key={entry.id} entry={entry} />
      ))}

      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`All achievements, ${earned} of ${achievements.length} unlocked`}
        style={styles.more}
      >
        <Text style={[text.bodySm, styles.moreLabel]}>All achievements</Text>
        <Text style={[text.caption, { color: paper.textFaint }]}>
          {earned} / {achievements.length}
        </Text>
        <CaretRight size={13} weight="bold" color={marmalade[600]} />
      </Pressable>
    </View>
  );
});

/**
 * One line: glyph, name, and either a tick or the distance left.
 *
 * Every row carries a meter — earned ones full, open ones part-way, locked ones empty.
 *
 * Showing it only where there was progress meant a list of three could easily show one
 * bar, and a row's meaning then depended on whether the row above it happened to have one.
 * A track on every line makes the list one shape, read down a single column: how far along
 * is each of these.
 */
const Row = React.memo(function Row({ entry }: { entry: Achievement }) {
  const { Glyph } = entry;
  // The three entries that came over from the weekly goal rows keep the hue they wore
  // there — a tinted tile and a meter in the same colour. Everything else is on coral.
  const accent = entry.accent ?? marmalade[600];
  const tint = entry.accent ? `${entry.accent}1F` : marmalade[100];

  const justEarned = useJustChanged(entry.achieved);
  const justOpened = useJustChanged(entry.unlocked && !entry.achieved);

  const reduceMotion = useReduceMotion();
  // Both rest at 1, which is the settled state. An animation starts by knocking its value
  // down and springing back, so a row that never animates needs no branch in the worklet.
  const pop = useSharedValue(1);
  const lift = useSharedValue(1);

  /**
   * The moment of earning it, and the moment it opens.
   *
   * Both fire only on a *transition*, never on mount — an achievement you earned last week
   * popping every time the screen renders is confetti for old news. `useJustChanged`
   * returns true for the render in which the flag flipped and false forever after.
   *
   * Earning overshoots (the tick punches in); unlocking is a quieter lift of the whole
   * row, because the player has not done the thing yet, they have only been handed the
   * chance to. Transform and opacity only, on the UI thread.
   */
  useEffect(() => {
    if (reduceMotion) return;

    if (justEarned) {
      pop.value = 0.55;
      pop.value = withSpring(1, spring.overshoot);
    }

    if (justOpened) {
      lift.value = 0;
      lift.value = withSpring(1, spring.soft);
    }
  }, [justEarned, justOpened, lift, pop, reduceMotion]);

  const tickStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
  }));

  const rowStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * lift.value,
    transform: [{ translateX: (1 - lift.value) * 10 }],
  }));

  return (
    <Animated.View style={[styles.row, rowStyle]}>
      <View
        style={[
          styles.badge,
          { backgroundColor: entry.achieved || entry.current > 0 ? tint : paper.sunken },
        ]}
      >
        <Glyph
          size={15}
          weight={entry.achieved ? 'fill' : 'regular'}
          color={entry.achieved || entry.current > 0 ? accent : paper.textFaint}
        />
      </View>

      <View style={styles.body}>
        <Text
          style={[text.bodySm, { color: entry.achieved ? paper.text : paper.textMuted }]}
          numberOfLines={1}
        >
          {entry.title}
        </Text>

        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              {
                width: `${Math.round(entry.ratio * 100)}%`,
                // A locked entry's bar is greyed rather than tinted: it is showing what is
                // already done toward something the player cannot start yet.
                backgroundColor: entry.unlocked ? accent : paper.hairlineHi,
              },
            ]}
          />
        </View>
      </View>

      {entry.achieved ? (
        <Animated.View style={tickStyle}>
          <CheckCircle size={16} weight="fill" color={accent} />
        </Animated.View>
      ) : (
        <Text style={[text.caption, styles.count]}>
          {entry.current}
          <Text style={{ color: paper.textFaint }}>{` / ${entry.target}`}</Text>
        </Text>
      )}
    </Animated.View>
  );
});

/**
 * True for the one render in which `value` went false to true.
 *
 * The alternative — animating whenever the flag is true — replays every earned achievement
 * on every mount, which turns a reward into wallpaper. Seeded with the value it was given
 * first, so the entries a player already had when the screen opened are simply there.
 */
function useJustChanged(value: boolean): boolean {
  const previous = useRef(value);
  const changed = value && !previous.current;

  useEffect(() => {
    previous.current = value;
  }, [value]);

  return changed;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 5,
  },
  track: {
    height: 3,
    borderRadius: radii.full,
    backgroundColor: paper.sunken,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
  },
  count: {
    color: paper.textMuted,
  },
  /** The way out. Accent-coloured and last, so the list ends on a door. */
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  moreLabel: {
    flex: 1,
    color: marmalade[600],
  },
});
