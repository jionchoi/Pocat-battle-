import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Cat, PaperPlaneTilt, X } from 'phosphor-react-native';

import type { CapturePhase, DetectionBox } from '../store/captureStore';
import { CircleButton } from './CircleButton';
import {
  arena,
  chrome,
  glass,
  hitSlopFor,
  marmalade,
  press,
  radii,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../theme';

/**
 * CaptureOverlay — the camera's entire UI (README section 6).
 *
 * Arena context throughout: this is a committed immersive screen, so there is no light
 * surface anywhere on it.
 *
 * ## One control, not two
 *
 * The countdown ring and the shutter used to be separate objects — a ring in the middle of
 * the screen and a button in a strip at the bottom — which asked the player to watch one
 * thing and press another. They are now the same object: the ring is the shutter, it sits
 * where the player is already looking, and the arc closing around it is the framing window
 * running out.
 *
 * That matters because the framing window is the whole skill of this app. A player who
 * does not understand why the ring is counting down will snap instantly every time and
 * never discover that waiting scores higher, so the prompt under it says what to do rather
 * than what is happening.
 */

export interface CaptureOverlayProps {
  phase: CapturePhase;
  box: DetectionBox | null;
  /** 0..1 through the framing window. */
  progress: number;
  remainingMs: number;
  detectionStreak: number;
  framesRequired: number;
  onShutter: () => void;
  onClose: () => void;
  /** Sharing default comes from the player's settings; toggling here is per-shot. */
  shareToFeed: boolean;
  onToggleShare: () => void;
}

export const CaptureOverlay = React.memo(function CaptureOverlay({
  phase,
  box,
  progress,
  remainingMs,
  detectionStreak,
  framesRequired,
  onShutter,
  onClose,
  shareToFeed,
  onToggleShare,
}: CaptureOverlayProps) {
  const busy = phase === 'capturing' || phase === 'scoring';
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {box ? <DetectionFrame box={box} locked={phase === 'framing'} /> : null}

      <View style={styles.top} pointerEvents="box-none">
        <CircleButton
          Glyph={X}
          onPress={onClose}
          accessibilityLabel="Close the camera"
        />

        {/*
          The design's slot for a flash toggle. This app has no flash — a startled cat is
          a worse photo than a dark one — so the slot carries the control that actually
          changes what this shot does: whether it goes to the feed.
        */}
        <CircleButton
          Glyph={PaperPlaneTilt}
          onPress={onToggleShare}
          accessibilityLabel="Share this shot to the community feed"
          glyphSize={17}
          style={shareToFeed ? styles.shareOn : undefined}
        />
      </View>

      <View style={styles.centre} pointerEvents="box-none">
        <Shutter
          phase={phase}
          progress={progress}
          onPress={onShutter}
          disabled={busy}
        />

        <View style={styles.prompt} pointerEvents="none">
          <PromptCopy
            phase={phase}
            detectionStreak={detectionStreak}
            framesRequired={framesRequired}
          />
        </View>

        {/*
          The countdown is a bare numeral with no label. At 88pt under a closing ring it
          needs no explaining, and "3s remaining" next to it would be the app narrating
          something the player can already see.
        */}
        {phase === 'framing' && seconds > 0 ? (
          <Text style={[text.displayHuge, styles.countdown]}>{seconds}</Text>
        ) : null}
      </View>

      <View style={styles.bottom} pointerEvents="none">
        <ModePill
          label={phase === 'framing' ? 'Auto capture' : 'Tap to shoot'}
          active={phase === 'framing'}
        />
        {shareToFeed ? <ModePill label="Sharing to feed" /> : null}
      </View>
    </View>
  );
});

/** Wide-tracked mono capitals on glass. Names the mode; never prose. */
const ModePill = React.memo(function ModePill({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <View style={styles.pill}>
      <BlurView
        intensity={glass.intensity}
        tint={glass.tintDark}
        style={[StyleSheet.absoluteFill, styles.pillRadius]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.pillRadius,
          { backgroundColor: 'rgba(255,255,255,0.12)' },
        ]}
      />
      <Text style={[text.eyebrow, { color: active ? marmalade[500] : chrome.text }]}>
        {label}
      </Text>
    </View>
  );
});

/**
 * Prompt copy, per phase.
 *
 * "Wait for a better moment" is doing the teaching: it is the one sentence that explains
 * why the countdown exists at all.
 */
const PromptCopy = React.memo(function PromptCopy({
  phase,
  detectionStreak,
  framesRequired,
}: {
  phase: CapturePhase;
  detectionStreak: number;
  framesRequired: number;
}) {
  if (phase === 'capturing') {
    return <Text style={[text.h3, styles.promptText]}>Holding still</Text>;
  }

  if (phase === 'scoring') {
    return <Text style={[text.h3, styles.promptText]}>Scoring your shot</Text>;
  }

  if (phase === 'framing') {
    return (
      <Text style={[text.h3, styles.promptText]}>Wait for a better moment</Text>
    );
  }

  if (detectionStreak > 0) {
    return (
      <Text style={[text.bodySm, styles.promptSub]}>
        {`Holding focus ${detectionStreak} of ${framesRequired}`}
      </Text>
    );
  }

  return (
    <Text style={[text.bodySm, styles.promptSub]}>Point the camera at a cat</Text>
  );
});

/** Detection bounding box. A thin rounded rect, well behind the ring in emphasis. */
const DetectionFrame = React.memo(function DetectionFrame({
  box,
  locked,
}: {
  box: DetectionBox;
  locked: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const settle = useSharedValue(0);

  useEffect(() => {
    settle.value = reduceMotion
      ? locked
        ? 1
        : 0
      : withTiming(locked ? 1 : 0, {
          duration: 320,
          easing: Easing.bezier(0.32, 0.72, 0, 1),
        });
  }, [locked, reduceMotion, settle]);

  const animated = useAnimatedStyle(() => ({
    borderColor: locked ? arena.hairlineHi : arena.hairline,
    opacity: 0.4 + settle.value * 0.35,
    transform: [{ scale: 1 + (1 - settle.value) * 0.02 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.detection,
        {
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.width * 100}%`,
          height: `${box.height * 100}%`,
        },
        animated,
      ]}
    />
  );
});

const RING_SIZE = 220;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The shutter: a ring you can press, with the framing window drawn around its edge.
 *
 * The arc is a real SVG stroke driven by `strokeDashoffset` through `useAnimatedProps`,
 * so it runs on the UI thread. That matters more here than anywhere else in the product —
 * this is animating on top of a live camera preview while frames are being analysed, and
 * a JS-driven animation visibly stutters under that load.
 *
 * The ring does not turn red as it empties. The window running out is not a failure; it
 * just means the app takes the shot for you.
 */
const Shutter = React.memo(function Shutter({
  phase,
  progress,
  onPress,
  disabled,
}: {
  phase: CapturePhase;
  progress: number;
  onPress: () => void;
  disabled: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);
  const sweep = useSharedValue(0);
  const detected = phase === 'framing';

  const clamped = Math.max(0, Math.min(1, progress));

  useEffect(() => {
    // Linear is correct here and nowhere else: this represents real elapsed time, and
    // easing it would make the ring lie about how long is left.
    sweep.value = reduceMotion
      ? clamped
      : withTiming(clamped, { duration: 80, easing: Easing.linear });
  }, [clamped, reduceMotion, sweep]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - sweep.value),
  }));

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - press.scale) * pressed.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        pressed.value = reduceMotion ? 0 : withSpring(1, spring.snap);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, spring.snap);
      }}
      hitSlop={hitSlopFor(RING_SIZE)}
      accessibilityRole="button"
      accessibilityLabel={detected ? 'Take the shot now' : 'Take a photo'}
      accessibilityState={{ disabled }}
    >
      <Animated.View
        style={[styles.ring, { opacity: disabled ? 0.5 : 1 }, animated]}
      >
        <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={arena.hairlineHi}
            strokeWidth={RING_STROKE}
          />
          {detected ? (
            <AnimatedCircle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={marmalade[600]}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              // Starts at twelve o'clock rather than three, so the arc closes the way a
              // clock does and not from an arbitrary point on the right-hand side.
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              animatedProps={arcProps}
            />
          ) : null}
        </Svg>

        <Cat
          size={56}
          weight={detected ? 'fill' : 'regular'}
          color={detected ? chrome.text : arena.textMuted}
        />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: 62,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shareOn: {
    // The one place a control's *state* is worth the accent on this screen.
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: marmalade[600],
  },
  centre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Lifts the ring off dead centre so the countdown numeral underneath it does not sit
    // on the bottom edge of the frame.
    paddingBottom: 96,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prompt: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  promptText: {
    color: chrome.text,
    textAlign: 'center',
  },
  promptSub: {
    color: arena.textMuted,
    textAlign: 'center',
  },
  countdown: {
    marginTop: spacing.xs,
    color: chrome.text,
  },
  detection: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: radii.lg,
  },
  bottom: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 54,
    alignItems: 'center',
    gap: spacing.xs,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  pillRadius: {
    borderRadius: radii.full,
  },
});
