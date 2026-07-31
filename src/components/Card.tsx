import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  concentric,
  contextColors,
  elevation,
  innerHighlight,
  radii,
  spacing,
  type ContextName,
  type ElevationLevel,
} from '../theme';

export interface CardProps {
  children: React.ReactNode;
  context?: ContextName;
  /** Default is flat — a shadow is opt-in and only when elevation means something. */
  level?: ElevationLevel;
  /** Outer shell tint, e.g. a rarity tint. Falls back to the sunken surface. */
  shellColor?: string;
  /** Outer shell ring. Falls back to the context hairline. */
  ringColor?: string;
  radius?: number;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

const SHELL_PAD = 6;

/**
 * Base surface using the Double-Bezel: an outer shell that reads as a machined tray, and
 * an inner core that reads as the plate sitting in it. Radii are concentric, so the two
 * curves agree at the corner.
 *
 * The default is deliberately flat — most groupings in this app should be a hairline or
 * negative space, not another box with a shadow.
 */
export const Card = React.memo(function Card({
  children,
  context = 'bone',
  level = 'flat',
  shellColor,
  ringColor,
  radius = radii.xl,
  padding = spacing.md,
  style,
  contentStyle,
}: CardProps) {
  const c = contextColors(context);

  return (
    <View
      style={[
        {
          backgroundColor: shellColor ?? c.sunken,
          borderColor: ringColor ?? c.hairline,
          borderRadius: radius,
          borderWidth: 1,
          padding: SHELL_PAD,
        },
        elevation(level, context),
        style,
      ]}
    >
      <View
        style={[
          styles.core,
          {
            backgroundColor: c.surface,
            borderRadius: concentric(radius, SHELL_PAD),
            padding,
          },
          innerHighlight(c.innerHighlight),
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
});

/**
 * Hairline-separated group. This is the preferred container for settings, lists and stat
 * rows — no box, no shadow, just structure.
 */
export const DividedGroup = React.memo(function DividedGroup({
  children,
  context = 'bone',
  style,
}: {
  children: React.ReactNode;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={style}>
      {items.map((child, index) => (
        <View
          key={index}
          style={
            index === 0
              ? undefined
              : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }
          }
        >
          {child}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  core: {
    overflow: 'hidden',
  },
});
