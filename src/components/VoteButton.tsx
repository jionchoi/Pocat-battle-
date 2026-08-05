import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { Heart, Smiley, StarFour } from 'phosphor-react-native';

import { REACTION_LABELS, REACTIONS } from '../constants/game';
import type { Reaction } from '../models';
import {
  contextColors,
  marmalade,
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

/**
 * `wow` is a four-pointed star rather than a sparkle: the sparkle glyph is already the
 * discoverer mark on a Cat Dex tile, and one shape cannot mean both "you found this cat
 * first" and "this made me go wow".
 */
const GLYPHS = { laugh: Smiley, love: Heart, wow: StarFour } as const;

export type VoteButtonSize = 'sm' | 'lg';

export const VoteButton = React.memo(function VoteButton({
  reaction,
  count,
  active,
  onPress,
  disabled = false,
  size = 'sm',
  context = 'paper',
  style,
}: {
  reaction: Reaction;
  count: number;
  active: boolean;
  onPress: () => void;
  /** True on your own photos — you cannot react to yourself. */
  disabled?: boolean;
  /**
   * `sm` is the inline pill that rides under a feed card. `lg` is the 44pt bar used on
   * Photo Detail, where reacting is a primary action and not an afterthought — and where
   * three equal bars across the width make the three choices read as equally available.
   */
  size?: VoteButtonSize;
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

  const large = size === 'lg';
  const fg = active ? marmalade[600] : large ? c.text : c.textMuted;

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={hitSlopFor(large ? 44 : 40)}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={`${REACTION_LABELS[reaction]}${count > 0 ? `, ${count}` : ''}`}
      style={[large && styles.largeHit, style]}
    >
      <Animated.View
        style={[
          styles.button,
          large ? styles.large : styles.small,
          {
            backgroundColor: active ? marmalade[100] : large ? c.sunkenSoft : c.sunken,
            opacity: disabled ? 0.45 : 1,
          },
          animated,
        ]}
      >
        <Glyph
          size={large ? icon.size.md : icon.size.sm}
          color={fg}
          weight={active || large ? icon.weightActive : icon.weightDefault}
        />
        {/*
          The large bar always shows its count, including zero. It is a fixed-width slot
          in a row of three, and a button that changes width the instant someone taps it
          makes the other two jump sideways.
        */}
        {large || count > 0 ? (
          <Text style={[text.stat, !large && styles.count, { color: fg }]}>{count}</Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
});

/** The full reaction row, as it appears under a feed photo or on Photo Detail. */
export const VoteRow = React.memo(function VoteRow({
  reactions,
  myReaction,
  onReact,
  disabled = false,
  size = 'sm',
  context = 'paper',
  style,
}: {
  reactions: Record<Reaction, number>;
  myReaction: Reaction | null;
  onReact: (reaction: Reaction) => void;
  disabled?: boolean;
  size?: VoteButtonSize;
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
          size={size}
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
    justifyContent: 'center',
    borderRadius: radii.full,
  },
  small: {
    gap: spacing.xxs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  large: {
    gap: 6,
    height: 44,
  },
  largeHit: {
    flex: 1,
  },
  count: {
    fontSize: 12,
    lineHeight: 16,
  },
});
