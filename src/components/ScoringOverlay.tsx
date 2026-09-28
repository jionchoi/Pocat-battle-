import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import type { CapturePhase } from '../store/captureStore';
import {
  arena,
  chrome,
  marmalade,
  spacing,
  text,
  useReduceMotion,
} from '../theme';

/**
 * The wait between the shutter and the score.
 *
 * ## Why the camera stops
 *
 * The preview used to stay live under a "Scoring your shot" label, which showed the
 * player a moving scene while the app judged a still one — and if the cat walked off
 * during the upload, the screen said the app was scoring an empty doorway. Freezing the
 * frame the shutter actually captured makes the wait about *this photo*, and it is also
 * the first sight of the shot the player just took: the reveal then opens on the same
 * image, so the two screens read as one continuous moment rather than as two loads.
 *
 * ## The arc is tied to the actual work
 *
 * `progress` comes from the capture pipeline's own milestones — shutter, file written,
 * image encoded, request in flight, verdict — not from a timer (see CAPTURE_PROGRESS).
 * The ring chases whatever the last completed step is worth, so a slow encode holds it at
 * 22% and a slow network holds it at 52%: where it stops tells you what is slow.
 *
 * The one liberty it takes is a small lead. Between milestones the arc drifts a few
 * percent past the last one so a long upload does not look frozen, but it can never reach
 * the next milestone before that step has actually finished, and it only reaches 100% when
 * the score is in hand.
 */

const RING_SIZE = 168;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** How often the arc is re-aimed. Matches the framing ring's JS-driven cadence. */
const TICK_MS = 90;
/**
 * How far past the last completed milestone the arc may drift, and how fast it closes the
 * remaining distance each tick. Small enough that the lead never reaches the next
 * milestone, which is what keeps the position meaningful.
 */
const LEAD = 0.07;
const CHASE = 0.12;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface ScoringOverlayProps {
  phase: CapturePhase;
  /** The frozen frame. Null for the instant between the shutter and the file landing. */
  photoUri: string | null;
  /** The pipeline's own 0..1 milestone. See `CAPTURE_PROGRESS`. */
  progress: number;
}

export const ScoringOverlay = React.memo(function ScoringOverlay({
  phase,
  photoUri,
  progress: milestone,
}: ScoringOverlayProps) {
  const reduceMotion = useReduceMotion();
  const done = phase === 'revealed';

  /*
   * The shown value chases the milestone in JS and is mirrored onto a shared value for the
   * paint. Deriving the percentage text from the shared value instead would need the
   * animated `TextInput` trick to read a worklet value back into text, which is fragile on
   * the new architecture. A 90ms tick on a screen with no camera analysis running is
   * cheap, and it is the same shape as the framing ring, which is also stepped from JS.
   */
  const [shown, setShown] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (done) {
      setShown(1);
      return;
    }

    const id = setInterval(() => {
      setShown((current) => {
        // Never behind the work, never more than a hair in front of it.
        const ceiling = Math.min(milestone + LEAD, 0.97);
        if (current >= ceiling) return current;
        return current + (ceiling - current) * CHASE;
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [done, milestone]);

  // A completed step is a real jump, so the value snaps up to it rather than waiting for
  // the chase to walk there.
  useEffect(() => {
    setShown((current) => (milestone > current ? milestone : current));
  }, [milestone]);

  useEffect(() => {
    progress.value = withTiming(shown, {
      // Reduce-motion still gets the arc — it is information, not decoration — but it
      // steps to each value instead of sliding there.
      duration: reduceMotion ? 0 : done ? 280 : TICK_MS * 1.6,
      // Linear between steps while it is chasing: the target is already eased by the
      // chase itself, and easing twice makes the arc stutter at every tick boundary.
      easing: done ? Easing.bezier(0.32, 0.72, 0, 1) : Easing.linear,
    });
  }, [done, progress, reduceMotion, shown]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress.value),
  }));

  /** The coral wash rising from the bottom edge as the score gets closer. */
  const washStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.04 + progress.value * 0.96 }],
    opacity: 0.16 + progress.value * 0.14,
  }));

  /** The arc's own head, which sits wherever the progress got to. */
  const headStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 360}deg` }],
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      {photoUri ? (
        <Image
          source={photoUri}
          contentFit="cover"
          transition={0}
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityLabel="The photo you just took"
        />
      ) : null}

      {/* Enough to hold white type over an unknown photo, not enough to hide the cat. */}
      <View pointerEvents="none" style={styles.scrim} />

      <Animated.View pointerEvents="none" style={[styles.wash, washStyle]}>
        <LinearGradient
          colors={['rgba(255,90,54,0)', marmalade[600]]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={styles.centre} pointerEvents="none">
        <View style={styles.ring}>
          <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth={RING_STROKE}
            />
            <AnimatedCircle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={marmalade[600]}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              // Twelve o'clock, so the arc fills the way a clock reads.
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              animatedProps={arcProps}
            />
          </Svg>

          {/* The arc's head. One dot, on the one thing worth pointing at. */}
          <Animated.View style={[StyleSheet.absoluteFill, headStyle]}>
            <View style={styles.dot} />
          </Animated.View>

          <Text style={[text.displayHuge, styles.percent]}>
            {`${Math.round(shown * 100)}%`}
          </Text>
        </View>

        <Text style={[text.h3, styles.status]}>
          {phase === 'capturing' ? 'Holding the frame' : done ? 'Got it' : 'Scoring your shot'}
        </Text>
        <Text style={[text.bodySm, styles.sub]}>
          {done
            ? 'Here comes the verdict'
            : 'Reading the pose, the light and how rare this cat is'}
        </Text>
      </View>
    </View>
  );
});

const DOT_SIZE = 12;

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  /**
   * Anchored to the bottom edge and grown with `scaleY`, never with `height` — a height
   * animation lays out every frame, which the motion spec bans outright.
   */
  wash: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '100%',
    transform: [{ scaleY: 0 }],
    transformOrigin: 'bottom',
  },
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: -DOT_SIZE / 2 + RING_STROKE / 2,
    left: RING_SIZE / 2 - DOT_SIZE / 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: marmalade[600],
  },
  percent: {
    color: chrome.text,
    fontSize: 40,
    lineHeight: 44,
  },
  status: {
    marginTop: spacing.xl,
    color: chrome.text,
    textAlign: 'center',
  },
  sub: {
    marginTop: spacing.xxs,
    color: arena.textMuted,
    textAlign: 'center',
  },
});
