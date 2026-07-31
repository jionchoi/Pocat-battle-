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
  fern,
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
  color = fern[600],
  trackColor,
  height = 6,
  context = 'bone',
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
 * One row of the score breakdown: a labelled 0-100 component with a mono value.
 *
 * Score components animate `scaleX` from zero on mount so the reveal reads as the score
 * being tallied rather than as four bars that were always there.
 */
export const ScoreMeter = React.memo(function ScoreMeter({
  label,
  value,
  max = 100,
  color = fern[600],
  context = 'bone',
  delayMs = 0,
  animate = true,
  style,
}: {
  label: string;
  value: number;
  max?: number;
  color?: string;
  context?: ContextName;
  /** Stagger, so the four components tally in sequence during the reveal. */
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

  return (
    <View style={style}>
      <View style={styles.labelRow}>
        <Text style={[text.bodySm, { color: c.textMuted }]}>{label}</Text>
        <Text style={[text.stat, { color: c.text }]}>{Math.round(value)}</Text>
      </View>

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
    </View>
  );
});

/**
 * The framing-window countdown ring (README section 9.1, step 3).
 *
 * Drawn as a rotating sweep rather than an animated SVG arc: RN has no cheap way to
 * animate a stroke-dasharray on the UI thread, and this is running over a live camera
 * preview where a JS-driven animation would visibly stutter. `transform` only.
 *
 * The ring deliberately does not turn red as it empties — the window running out is not
 * a failure, it just means the app takes the shot for you.
 */
export const FramingRing = React.memo(function FramingRing({
  progress,
  size = 92,
  thickness = 4,
  color = '#F5F1EB',
  trackColor = 'rgba(245, 241, 235, 0.22)',
}: {
  /** 0..1 through the window. */
  progress: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const sweep = useSharedValue(clamped);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    // Linear is correct here and nowhere else: this represents real elapsed time, and
    // easing it would make the ring lie about how long is left.
    sweep.value = reduceMotion
      ? clamped
      : withTiming(clamped, { duration: 60, easing: Easing.linear });
  }, [clamped, reduceMotion, sweep]);

  const halfStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sweep.value * 360}deg` }],
  }));

  return (
    <View
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderWidth: thickness, borderColor: trackColor },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="Framing window"
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
    >
      <Animated.View
        style={[
          styles.ringSweep,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: thickness,
            borderTopColor: color,
            borderRightColor: color,
            borderBottomColor: 'transparent',
            borderLeftColor: 'transparent',
          },
          halfStyle,
        ]}
      />
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
