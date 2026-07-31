import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { Heart, Smiley, Sparkle } from 'phosphor-react-native';

import { REACTION_LABELS, REACTIONS } from '../constants/game';
import type { Reaction } from '../models';
import {
  contextColors,
  fern,
  hitSlopFor,
  icon,
  radii,
  spacing,
  spring,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';

/**
 * VoteButton — the community feed's reaction control (README section 9.5).
 *
 * There is no downvote, by design. The set is laugh / love / wow, so the worst a player
 * can do to someone's photo is ignore it. That is a structural decision, not a
 * moderation policy: you cannot brigade with buttons that do not exist.
 *
 * Tapping an active reaction clears it; tapping a different one replaces it. The server
 * enforces the same rule, so the counts cannot be inflated by tapping every option.
 */

const GLYPHS = { laugh: Smiley, love: Heart, wow: Sparkle } as const;

export const VoteButton = React.memo(function VoteButton({
  reaction,
  count,
  active,
  onPress,
  disabled = false,
  context = 'bone',
  style,
}: {
  reaction: Reaction;
  count: number;
  active: boolean;
  onPress: () => void;
  /** True on your own photos — you cannot react to yourself. */
  disabled?: boolean;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const reduceMotion = useReduceMotion();
  const pop = useSharedValue(1);

  const Glyph = GLYPHS[reaction];

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
  }));

  const handlePress = () => {
    if (!reduceMotion) {
      // Overshoot, not a linear scale: the reaction should feel like a small physical
      // response to the tap.
      pop.value = withSequence(
        withSpring(1.18, spring.overshoot),
        withSpring(1, spring.snap)
      );
    }
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={hitSlopFor(40)}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={`${REACTION_LABELS[reaction]}${count > 0 ? `, ${count}` : ''}`}
      style={style}
    >
      <Animated.View
        style={[
          styles.button,
          {
            backgroundColor: active ? fern[100] : c.sunken,
            opacity: disabled ? 0.45 : 1,
          },
          animated,
        ]}
      >
        <Glyph
          size={icon.size.sm}
          color={active ? fern[700] : c.textMuted}
          weight={active ? icon.weightActive : icon.weightDefault}
        />
        {count > 0 ? (
          <Text style={[text.stat, styles.count, { color: active ? fern[700] : c.textMuted }]}>
            {count}
          </Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
});

/** The full reaction row, as it appears under a feed photo. */
export const VoteRow = React.memo(function VoteRow({
  reactions,
  myReaction,
  onReact,
  disabled = false,
  context = 'bone',
  style,
}: {
  reactions: Record<Reaction, number>;
  myReaction: Reaction | null;
  onReact: (reaction: Reaction) => void;
  disabled?: boolean;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      {REACTIONS.map((reaction) => (
        <VoteButton
          key={reaction}
          reaction={reaction}
          count={reactions[reaction] ?? 0}
          active={myReaction === reaction}
          onPress={() => onReact(reaction)}
          disabled={disabled}
          context={context}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
  },
  count: {
    fontSize: 12,
    lineHeight: 16,
  },
});
