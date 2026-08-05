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
  chrome,
  contextColors,
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
 *
 * The selected chip is chrome black rather than the accent. A coral chip would be the
 * third coral element on the feed — after the trending flame and the capture shutter —
 * and the accent stops meaning "act here" the moment three unrelated things wear it.
 * Black is unambiguous, and the contrast against the unselected grey is far higher than
 * tint-on-tint ever was.
 */
export const FilterChips = React.memo(function FilterChips({
  options,
  selected,
  onSelect,
  context = 'paper',
  /**
   * Horizontal inset applied to the *content*, not to the scroll frame. A full-bleed rail
   * has to start on the screen gutter while still letting chips scroll to the very edge;
   * padding the frame instead would clip them into a floating box.
   */
  gutter = 0,
  style,
}: {
  options: readonly string[];
  selected?: string;
  onSelect: (value: string | undefined) => void;
  context?: ContextName;
  gutter?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.rail,
        gutter > 0 && { paddingLeft: gutter, paddingRight: gutter },
      ]}
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
              { backgroundColor: active ? chrome.fill : c.sunken },
            ]}
          >
            <Text
              style={[
                active ? text.caption : text.bodySm,
                { color: active ? chrome.text : c.textMuted },
              ]}
            >
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
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
  },
});
