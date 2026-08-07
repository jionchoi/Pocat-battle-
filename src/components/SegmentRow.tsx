import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { marmalade, paper, radii, spacing, text } from '../theme';

/**
 * Shared segmented control. Pill-shaped active state; sliding an indicator is unnecessary
 * at this size and would fight the wrap onto a second line.
 *
 * It used to live in the Leaderboard screen, which no longer has anything to segment — the
 * board is one board now. The Shop still uses it, so it moved here rather than being kept
 * alive by a screen that had stopped rendering it.
 */
export const SegmentRow = React.memo(function SegmentRow({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  style?: object;
}) {
  return (
    <View style={[styles.segments, style]}>
      {options.map((option) => {
        const active = option.key === value;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              {
                backgroundColor: active ? marmalade[100] : paper.sunken,
                borderColor: active ? marmalade[600] : 'transparent',
              },
            ]}
          >
            <Text
              style={[text.bodySm, { color: active ? marmalade[700] : paper.textMuted }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
});
