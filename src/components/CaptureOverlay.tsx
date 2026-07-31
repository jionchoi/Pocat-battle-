import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';

import type { CapturePhase, DetectionBox } from '../store/captureStore';
import {
  arena,
  glass,
  hitSlopFor,
  press,
  radii,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../theme';
import { FramingRing } from './ProgressBar';

/**
 * CaptureOverlay — the camera's entire UI (README section 6).
 *
 * Arena context throughout: this is a committed immersive screen, so there is no light
 * surface anywhere on it.
 *
 * The overlay has one job beyond looking good, which is to make the framing window
 * legible. A player who does not understand why the ring is counting down will snap
 * instantly every time and never discover that waiting scores higher — so the prompt
 * text changes with the phase and says what to do, not what is happening.
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

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {box ? <DetectionFrame box={box} locked={phase === 'framing'} /> : null}

      <View style={styles.top} pointerEvents="box-none">
        <Pressable
          onPress={onClose}
          hitSlop={hitSlopFor(44)}
          accessibilityRole="button"
          accessibilityLabel="Close the camera"
          style={styles.close}
        >
          <Text style={[text.bodySm, { color: arena.text }]}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.prompt} pointerEvents="none">
        <PromptCopy
          phase={phase}
          detectionStreak={detectionStreak}
          framesRequired={framesRequired}
          remainingMs={remainingMs}
        />
      </View>

      {/*
        The control strip is the one blurred surface here. BlurView over a live camera
        preview is expensive, so it is a single fixed element and never wraps anything
        that scrolls.
      */}
      <BlurView intensity={glass.intensity} tint={glass.tintDark} style={styles.strip}>
        <View style={[styles.stripInner, { borderColor: arena.hairline }]}>
          <Pressable
            onPress={onToggleShare}
            hitSlop={hitSlopFor(44)}
            accessibilityRole="switch"
            accessibilityState={{ checked: shareToFeed }}
            accessibilityLabel="Share this shot to the community feed"
            style={styles.shareToggle}
          >
            <View
              style={[
                styles.shareDot,
                {
                  backgroundColor: shareToFeed ? arena.text : 'transparent',
                  borderColor: shareToFeed ? arena.text : arena.hairlineHi,
                },
              ]}
            />
            <Text style={[text.caption, { color: arena.textMuted }]}>Share</Text>
          </Pressable>

          <Shutter
            phase={phase}
            progress={progress}
            onPress={onShutter}
            disabled={busy}
          />

          {/* Balances the strip so the shutter sits dead centre. */}
          <View style={styles.shareToggle} />
        </View>
      </BlurView>
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
  remainingMs,
}: {
  phase: CapturePhase;
  detectionStreak: number;
  framesRequired: number;
  remainingMs: number;
}) {
  if (phase === 'capturing') {
    return <Text style={[text.h3, styles.promptText]}>Holding still</Text>;
  }

  if (phase === 'scoring') {
    return <Text style={[text.h3, styles.promptText]}>Scoring your shot</Text>;
  }

  if (phase === 'framing') {
    const seconds = Math.ceil(remainingMs / 1000);
    return (
      <>
        <Text style={[text.h3, styles.promptText]}>Wait for a better moment</Text>
        <Text style={[text.bodySm, styles.promptSub]}>
          {seconds > 0
            ? `Shooting automatically in ${seconds}s`
            : 'Taking the shot'}
        </Text>
      </>
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

/** Detection bounding box. Corner brackets rather than a full rectangle. */
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
    borderColor: locked ? arena.text : arena.hairlineHi,
    opacity: 0.55 + settle.value * 0.45,
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

/**
 * The shutter.
 *
 * During the framing window the countdown ring wraps it, so the timer and the control it
 * governs are the same object — the player never has to look in two places. Progress is
 * shown in the button itself rather than as a separate spinner (README mandatory states:
 * "Progress in the shutter button itself").
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
  const pressed = useSharedValue(0);
  const reduceMotion = useReduceMotion();

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - press.scale) * pressed.value }],
  }));

  return (
    <View style={styles.shutterWrap}>
      {phase === 'framing' ? <FramingRing progress={progress} size={78} /> : null}

      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={() => {
          pressed.value = reduceMotion ? 0 : withSpring(1, spring.snap);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, spring.snap);
        }}
        hitSlop={hitSlopFor(78)}
        accessibilityRole="button"
        accessibilityLabel={
          phase === 'framing' ? 'Take the shot now' : 'Take a photo'
        }
        accessibilityState={{ disabled }}
        style={styles.shutterTouch}
      >
        <Animated.View
          style={[
            styles.shutterOuter,
            { borderColor: arena.text, opacity: disabled ? 0.5 : 1 },
            animated,
          ]}
        >
          <View style={[styles.shutterInner, { backgroundColor: arena.text }]} />
        </Animated.View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: spacing.xxxl,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  close: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: arena.surface,
  },
  prompt: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 170,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  promptText: {
    color: arena.text,
    textAlign: 'center',
  },
  promptSub: {
    color: arena.textMuted,
    textAlign: 'center',
  },
  detection: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: radii.lg,
  },
  strip: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xxl,
    borderRadius: radii.xxl,
    overflow: 'hidden',
  },
  stripInner: {
    // Real glass, not just a blur: the 1px inner border and the top highlight are what
    // make it read as a material rather than a smudge.
    borderWidth: StyleSheet.hairlineWidth,
    borderTopColor: arena.innerHighlight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.xxl,
  },
  shareToggle: {
    width: 66,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  shareDot: {
    width: 16,
    height: 16,
    borderRadius: radii.full,
    borderWidth: 1.5,
  },
  shutterWrap: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterTouch: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuter: {
    width: 66,
    height: 66,
    borderRadius: radii.full,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 52,
    height: 52,
    borderRadius: radii.full,
  },
});
