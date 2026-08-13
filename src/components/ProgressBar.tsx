import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import {
  contextColors,
  marmalade,
  radii,
  spacing,
  text,
  timing,
  useReduceMotion,
  type ContextName,
} from '../theme';

/**
 * Meters.
 *
 * Every fill animates `scaleX`, never `width`. Animating width triggers layout on every
 * frame, which is the single most common cause of a janky progress bar.
 */

export interface MeterBarProps {
  /** 0..1 */
  ratio: number;
  color?: string;
  trackColor?: string;
  height?: number;
  context?: ContextName;
  label?: string;
  valueLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Rank XP and album-quota progress. Hairline track, accent fill. */
export const MeterBar = React.memo(function MeterBar({
  ratio,
  color = marmalade[600],
  trackColor,
  height = 6,
  context = 'paper',
  label,
  valueLabel,
  style,
}: MeterBarProps) {
  const c = contextColors(context);
  const clamped = Math.max(0, Math.min(1, ratio));
  const progress = useSharedValue(clamped);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    progress.value = reduceMotion
      ? clamped
      : withTiming(clamped, timing.enter);
  }, [clamped, progress, reduceMotion]);

  const fill = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.001, progress.value) }],
  }));

  return (
    <View style={style}>
      {label || valueLabel ? (
        <View style={styles.labelRow}>
          {label ? (
            <Text style={[text.caption, { color: c.textMuted }]}>{label}</Text>
          ) : null}
          {valueLabel ? (
            <Text style={[text.stat, styles.value, { color: c.text }]}>{valueLabel}</Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.track,
          { height, backgroundColor: trackColor ?? c.meterTrack, borderRadius: height / 2 },
        ]}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      >
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: color, borderRadius: height / 2 },
            fill,
          ]}
        />
      </View>
    </View>
  );
});

/**
 * One row of the score breakdown: a labelled 0-100 component with its value.
 *
 * Two layouts, and the choice is about how many rows are stacked:
 *
 *  - `inline` puts label, track and value on one line. Three of these read as a small
 *    table, which is what the breakdown is — and at 3 rows it costs 66pt instead of 132.
 *  - `stacked` puts the label above the track, for rows whose label is long enough to
 *    need the full width ("Pose rarity · Mid-yawn").
 *
 * Score components animate `scaleX` from zero on mount so the reveal reads as the score
 * being tallied rather than as bars that were always there.
 */
export const ScoreMeter = React.memo(function ScoreMeter({
  label,
  value,
  max = 100,
  color = marmalade[600],
  context = 'paper',
  layout = 'inline',
  labelWidth = 92,
  delayMs = 0,
  animate = true,
  style,
}: {
  label: string;
  value: number;
  max?: number;
  color?: string;
  context?: ContextName;
  layout?: 'inline' | 'stacked';
  /** Fixed so the three tracks start on a common left edge and stay comparable. */
  labelWidth?: number;
  /** Stagger, so the components tally in sequence during the reveal. */
  delayMs?: number;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));

  const progress = useSharedValue(animate ? 0 : ratio);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!animate || reduceMotion) {
      progress.value = ratio;
      return;
    }

    progress.value = withDelay(
      delayMs,
      withTiming(ratio, { duration: 620, easing: Easing.bezier(0.32, 0.72, 0, 1) })
    );
  }, [animate, delayMs, progress, ratio, reduceMotion]);

  const fill = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.001, progress.value) }],
  }));

  const track = (
    <View
      style={[styles.track, { height: 6, backgroundColor: c.meterTrack }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ now: Math.round(value), min: 0, max }}
    >
      <Animated.View
        style={[styles.fill, { backgroundColor: color, borderRadius: 3 }, fill]}
      />
    </View>
  );

  if (layout === 'inline') {
    return (
      <View style={[styles.inlineRow, style]}>
        <Text
          style={[text.caption, { width: labelWidth, color: c.textMuted }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <View style={styles.inlineTrack}>{track}</View>
        <Text style={[text.stat, styles.inlineValue, { color: c.text }]}>
          {Math.round(value)}
        </Text>
      </View>
    );
  }

  return (
    <View style={style}>
      <View style={styles.labelRow}>
        <Text style={[text.bodySm, { color: c.textMuted }]}>{label}</Text>
        <Text style={[text.stat, { color: c.text }]}>{Math.round(value)}</Text>
      </View>
      {track}
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    // scaleX grows from the centre by default; this anchors growth to the left edge.
    transformOrigin: 'left',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xxs,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inlineTrack: {
    flex: 1,
  },
  inlineValue: {
    minWidth: 24,
    textAlign: 'right',
  },
  value: {
    fontSize: 12,
    lineHeight: 16,
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSweep: {
    position: 'absolute',
    top: -1,
    left: -1,
  },
});
