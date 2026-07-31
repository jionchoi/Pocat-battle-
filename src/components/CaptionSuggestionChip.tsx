import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  contextColors,
  fern,
  press,
  radii,
  spacing,
  staggerDelay,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';

/**
 * CaptionSuggestionChip — tappable suggested captions on the Score Result screen
 * (README sections 2 and 6).
 *
 * These are suggestions, not decisions: tapping one fills the caption field, which stays
 * editable. That distinction matters — a generated caption the player cannot change
 * would put words in their mouth on a photo they are about to share.
 */

export const CaptionSuggestionChip = React.memo(function CaptionSuggestionChip({
  caption,
  selected,
  onPress,
  index = 0,
  context = 'bone',
}: {
  caption: string;
  selected: boolean;
  onPress: () => void;
  index?: number;
  context?: ContextName;
}) {
  const c = contextColors(context);
  const reduceMotion = useReduceMotion();

  const pressed = useSharedValue(0);
  const enter = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      enter.value = 1;
      return;
    }

    enter.value = withDelay(
      staggerDelay(index),
      withTiming(1, { duration: 420, easing: Easing.bezier(0.32, 0.72, 0, 1) })
    );
  }, [enter, index, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 8 },
      { scale: 1 - (1 - press.scale) * pressed.value },
    ],
  }));

  return (
    <Animated.View style={animated}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, press.config);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityHint="Uses this caption. You can still edit it."
        accessibilityLabel={`Suggested caption: ${caption}`}
        style={[
          styles.chip,
          {
            backgroundColor: selected ? fern[100] : c.sunken,
            borderColor: selected ? fern[500] : c.hairline,
          },
        ]}
      >
        <Text
          style={[text.bodySm, { color: selected ? fern[700] : c.text }]}
          numberOfLines={2}
        >
          {caption}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

/**
 * The suggestion rail.
 *
 * Horizontally scrolling rather than wrapped, so three long captions do not push the
 * caption field off a small screen at the exact moment the player wants to edit it.
 */
export const CaptionSuggestions = React.memo(function CaptionSuggestions({
  suggestions,
  selected,
  onSelect,
  context = 'bone',
  style,
}: {
  suggestions: string[];
  selected: string | null;
  onSelect: (caption: string) => void;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  if (suggestions.length === 0) return null;

  return (
    <View style={style}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
        keyboardShouldPersistTaps="handled"
      >
        {suggestions.map((caption, index) => (
          <CaptionSuggestionChip
            key={caption}
            caption={caption}
            selected={selected === caption}
            onPress={() => onSelect(caption)}
            index={index}
            context={context}
          />
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  rail: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  chip: {
    maxWidth: 240,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});
