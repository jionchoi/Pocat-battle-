import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  contextColors,
  fern,
  radii,
  spacing,
  text,
  type ContextName,
} from '../../theme';

/**
 * Horizontal filter chips.
 *
 * Tapping the active chip clears it, so there is always a way back to the unfiltered
 * list without a separate "all" chip taking up a slot.
 */
export const FilterChips = React.memo(function FilterChips({
  options,
  selected,
  onSelect,
  context = 'bone',
  style,
}: {
  options: readonly string[];
  selected?: string;
  onSelect: (value: string | undefined) => void;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      style={style}
    >
      {options.map((option) => {
        const active = selected === option;

        return (
          <Pressable
            key={option}
            onPress={() => onSelect(active ? undefined : option)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityHint={active ? 'Clears this filter' : undefined}
            style={[
              styles.chip,
              {
                backgroundColor: active ? fern[100] : c.sunken,
                borderColor: active ? fern[500] : 'transparent',
              },
            ]}
          >
            <Text style={[text.bodySm, { color: active ? fern[700] : c.textMuted }]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  rail: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
  },
});
