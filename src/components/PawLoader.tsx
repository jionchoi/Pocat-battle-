import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { PawPrint } from 'phosphor-react-native';

import { icon, useReduceMotion } from '../theme';

/**
 * The waiting state. A cat walking, not a wheel spinning.
 *
 * `ActivityIndicator` is the one piece of chrome in this app that came from the platform
 * rather than from us — a grey system spinner in the middle of a coral button belongs to
 * iOS, not to Cat Frame. This is the replacement, and it is the same paw as the shutter
 * glyph, which is what ties "waiting" to "photographing a cat" rather than to "loading".
 *
 * ## The motion
 *
 * Paws step rather than pulse. Each print fades up and settles with a slight tilt, one
 * after the next, then the whole trail clears and the walk starts again — the rhythm of
 * an animal crossing the frame. Prints alternate their tilt so the trail reads as left
 * paw, right paw rather than as one stamp repeated.
 *
 * A single paw (`count={1}`, the button case) has no trail to walk, so it breathes in
 * place instead: the same fade, held longer.
 *
 * Only `opacity` and `transform` animate, and the loops are cancelled on unmount — a
 * loader that outlives its screen is a frame budget leaked into every screen after it.
 *
 * Under reduce-motion the tilt and the travel go away and the prints cross-fade in place,
 * which still says "working" without moving anything across the screen.
 */

/** One full walk cycle. Slow enough to read as steps rather than as a flicker. */
const CYCLE_MS = 1080;
/**
 * How far above the line a print hovers before it lands, in pixels.
 *
 * It travels *down* to zero, which is the opposite of what this used to do. The offset was
 * applied as the print landed and then held for most of the cycle, so a settled trail sat
 * three pixels above where it belonged — visible as a paw riding high inside a button, since
 * the loader stands exactly where the label's optical centre is.
 */
const STEP_RISE = 3;

export interface PawLoaderProps {
  /** Glyph size. Defaults to the small icon size, which is the in-button case. */
  size?: number;
  color: string;
  /** How many prints make up the trail. One breathes in place; three walk. */
  count?: 1 | 3;
  style?: StyleProp<ViewStyle>;
  /** Announced to screen readers. The paw itself says nothing to them. */
  label?: string;
}

export const PawLoader = React.memo(function PawLoader({
  size = icon.size.sm,
  color,
  count = 1,
  style,
  label = 'Working',
}: PawLoaderProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[styles.row, { gap: size * 0.28 }, style]}
    >
      {Array.from({ length: count }, (_, index) => (
        <Paw
          key={index}
          size={size}
          color={color}
          index={index}
          total={count}
          // A trail walks forward, so every other print is the other paw.
          mirrored={index % 2 === 1}
        />
      ))}
    </View>
  );
});

/**
 * One print.
 *
 * Its own leaf component so each print owns a single shared value and its own worklet —
 * driving three prints from one parent value would re-render the parent every frame,
 * which is the thing the motion spec's performance gate exists to prevent.
 */
const Paw = React.memo(function Paw({
  size,
  color,
  index,
  total,
  mirrored,
}: {
  size: number;
  color: string;
  index: number;
  total: number;
  mirrored: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    // Prints land in order across the cycle, so the trail is drawn rather than blinked.
    const stagger = (CYCLE_MS / total) * index;
    const step = CYCLE_MS / (total + 1);

    progress.value = withDelay(
      stagger,
      withRepeat(
        withSequence(
          withTiming(1, { duration: step, easing: Easing.bezier(0.32, 0.72, 0, 1) }),
          // Held while the prints behind it land, then cleared in the same order it was
          // drawn, so the trail always reads front-to-back rather than blinking.
          withTiming(1, { duration: CYCLE_MS - step * 2 }),
          withTiming(0, { duration: step, easing: Easing.bezier(0.4, 0, 1, 1) })
        ),
        -1,
        false
      )
    );

    return () => cancelAnimation(progress);
  }, [index, progress, total]);

  const animated = useAnimatedStyle(() => {
    // 0.35 rather than 0 so a resting print is still visible: the trail behind the
    // leading paw should read as fading footprints, not as empty space.
    const opacity = 0.35 + progress.value * 0.65;

    if (reduceMotion) return { opacity };

    return {
      opacity,
      transform: [
        // Lands *on* the line rather than above it: offset at rest, zero once placed.
        { translateY: -STEP_RISE * (1 - progress.value) },
        { rotate: `${(mirrored ? 16 : -16) * progress.value}deg` },
        { scale: 0.86 + progress.value * 0.14 },
      ],
    };
  });

  return (
    <Animated.View style={animated}>
      <PawPrint size={size} color={color} weight="fill" />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    /*
     * Centred in its own right, not only wherever it happens to be dropped.
     *
     * Every caller so far has centred it from outside — a button whose body is
     * `justifyContent: 'center'`, a sheet that stretches it. The moment one does not, a trail
     * that is meant to sit in the middle of a control is pinned to its left edge instead, and
     * that is not something the loader should be leaving to the site that mounts it.
     */
    justifyContent: 'center',
    /*
     * Half the lift back.
     *
     * Each print animates from `-STEP_RISE` to `0`, so at any instant a stagger of three has
     * some prints raised and some placed, and the group's optical centre sits `STEP_RISE / 2`
     * above the line the layout put it on — transforms do not move a box, only what is drawn
     * in it. Pushing the box down by that half puts the walk's midpoint back on the centre
     * line, so the trail reads as centred through the whole cycle rather than only at the
     * instant every paw happens to be down.
     */
    marginTop: STEP_RISE / 2,
  },
});
