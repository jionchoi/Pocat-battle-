import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  contextColors,
  elevation,
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
  /** Fill override, e.g. a rarity tint. Falls back to the soft well. */
  shellColor?: string;
  /** Optional hairline ring. Off by default — the fill already draws the boundary. */
  ringColor?: string;
  radius?: number;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Base surface: a single soft well.
 *
 * This used to be a Double-Bezel — a tinted outer shell wrapping a lighter inner core,
 * with concentric radii. That composition needs the page to be darker than the card, and
 * the page is now white: the core became the same colour as the background behind it, so
 * all the bezel rendered was a grey picture frame around nothing.
 *
 * One layer replaces it. The well is a shade off white, which is enough separation on a
 * white page and reads as recessed rather than as another floating box — and it lets a
 * card sit next to the reaction bars and dex rows that use the same fill without the two
 * looking like different materials.
 *
 * The default is deliberately flat. Most groupings in this app should be a hairline or
 * negative space; `level` is there for the few that genuinely float.
 */
export const Card = React.memo(function Card({
  children,
  context = 'paper',
  level = 'flat',
  shellColor,
  ringColor,
  radius = radii.lg,
  padding = spacing.md,
  style,
  contentStyle,
}: CardProps) {
  const c = contextColors(context);
  const ring = ringColor ?? null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: shellColor ?? c.sunkenSoft,
          borderRadius: radius,
          padding,
        },
        // A ring is opt-in. On a well that is already distinguishable by fill, a hairline
        // on top of it is a second statement of the same boundary.
        ring ? { borderWidth: 1, borderColor: ring } : null,
        elevation(level, context),
        style,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );
});

/**
 * Hairline-separated group. This is the preferred container for settings, lists and stat
 * rows — no box, no shadow, just structure.
 */
export const DividedGroup = React.memo(function DividedGroup({
  children,
  context = 'paper',
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
              : /*
                 * `hairlineHi`, not `hairline`, and the difference is whether this is visible
                 * at all.
                 *
                 * `hairline` is #F0F0F1 — about a four percent step off the white card it is
                 * drawn on, at a width of one physical pixel. The divider was rendering
                 * correctly and nobody could see it: the Privacy and location card read as one
                 * undivided block with two tappable halves. `hairlineHi` (#E3E3E6) is the token
                 * the palette already carries for a line that has to separate rather than
                 * merely suggest, which is exactly this job.
                 *
                 * `hairline` keeps its place bounding a card against the page, where the two
                 * surfaces differ anyway and the line only has to stop the edge looking soft.
                 */
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairlineHi }
          }
        >
          {child}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
