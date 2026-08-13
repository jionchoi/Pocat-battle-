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
import { Cat, X } from 'phosphor-react-native';

import type { CapturePhase } from '../store/captureStore';
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
 * ## One control, and it belongs to the player
 *
 * The shutter sits in the middle of the screen where the player is already looking, rather
 * than in a strip at the bottom — that split asked them to watch one thing and press another.
 *
 * The ring around it used to be a countdown. A framing window armed itself once the on-device
 * detector had held a cat for enough frames and then fired on its own, and the copy under it
 * taught that mechanic. All of it is gone: the detector, the "holding focus" counter, the
 * countdown and the auto-capture. The phone is not a better judge of the moment than the
 * person holding it, and the detector was a texture-and-motion placeholder that never judged
 * cats at all — so what it really did was make people wait to be allowed to photograph one.
 * The camera is live, the shutter is always armed, and the only thing that fires it is a
 * finger.
 */

export interface CaptureOverlayProps {
  phase: CapturePhase;
  onShutter: () => void;
  onClose: () => void;
}

export const CaptureOverlay = React.memo(function CaptureOverlay({
  phase,
  onShutter,
  onClose,
}: CaptureOverlayProps) {
  const busy = phase === 'capturing' || phase === 'scoring';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/*
        One control up here, and it is the way out.

        There used to be a share toggle in the opposite corner, set before the shot — which
        asked the player to decide whether a photo was worth publishing before they had
        seen it, or knew what it scored. That decision belongs on the reveal, where the
        photo is in front of them, and it is on the reveal now. Two buttons over a live
        viewfinder for one job was one too many.
      */}
      <View style={styles.top} pointerEvents="box-none">
        <CircleButton
          Glyph={X}
          onPress={onClose}
          accessibilityLabel="Close the camera"
        />
      </View>

      <View style={styles.centre} pointerEvents="box-none">
        {/* A plain ring. Nothing counts down in it any more, so nothing sweeps around it. */}
        <Shutter onPress={onShutter} disabled={busy} />

        <View style={styles.prompt} pointerEvents="none">
          <PromptCopy phase={phase} />
        </View>
      </View>

      <View style={styles.bottom} pointerEvents="none">
        <ModePill label="Tap to shoot" />
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
 * Three states, and none of them asks the player to wait for the app. This used to teach the
 * framing window, because the countdown was the mechanic. With the shutter back in the
 * player's hands there is no mechanic to explain, so the resting line says what the camera is
 * for and then gets out of the way.
 */
const PromptCopy = React.memo(function PromptCopy({ phase }: { phase: CapturePhase }) {
  if (phase === 'capturing') {
    return <Text style={[text.h3, styles.promptText]}>Holding still</Text>;
  }

  if (phase === 'scoring') {
    return <Text style={[text.h3, styles.promptText]}>Scoring your shot</Text>;
  }

  return (
    <Text style={[text.bodySm, styles.promptSub]}>Point the camera at a cat</Text>
  );
});

const RING_SIZE = 220;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The shutter: a ring you can press. The player decides the moment; nothing else fires it.
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
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

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
      accessibilityLabel="Take a photo"
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
        </Svg>

        <Cat size={56} weight="regular" color={arena.textMuted} />
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
