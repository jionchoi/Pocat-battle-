import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  chrome,
  elevation,
  marmalade,
  innerHighlight,
  radii,
  semantic,
  spacing,
  spring,
  text,
  timing,
  useReduceMotion,
} from '../theme';

/**
 * Toasts.
 *
 * Success copy carries no exclamation mark and errors are never "Oops" — the toast states
 * what happened. Anything the player must act on gets an inline error instead, because a
 * toast that disappears is not somewhere to put a decision.
 */

export type ToastTone = 'success' | 'error' | 'neutral';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = (item: ToastItem) => void;

let listener: Listener | null = null;
let nextId = 1;

/** Imperative, because a catch result or a failed save can fire from anywhere. */
export function showToast(message: string, tone: ToastTone = 'neutral'): void {
  listener?.({ id: nextId++, message, tone });
}

export function ToastHost() {
  const [item, setItem] = useState<ToastItem | null>(null);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const progress = useSharedValue(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    progress.value = reduceMotion
      ? 0
      : withTiming(0, timing.exit);
    // Keep the node mounted through the exit animation, then clear it.
    dismissTimer.current = setTimeout(() => setItem(null), reduceMotion ? 0 : 260);
  }, [progress, reduceMotion]);

  useEffect(() => {
    listener = (next) => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      setItem(next);
    };

    return () => {
      listener = null;
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!item) return;

    progress.value = reduceMotion ? 1 : withSpring(1, spring.overshoot);

    const timer = setTimeout(hide, 3200);
    return () => clearTimeout(timer);
  }, [hide, item, progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -16 }],
  }));

  if (!item) return null;

  const palette = {
    // Success is the accent, not green: the accent already means "this worked" everywhere
    // else in the product, and a green that appears only in toasts is a colour the player
    // has to learn for one surface.
    success: { bg: marmalade[600], fg: chrome.text },
    error: { bg: semantic.danger, fg: chrome.text },
    neutral: { bg: chrome.fill, fg: chrome.text },
  }[item.tone];

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.wrap,
        { top: insets.top + spacing.xs },
        elevation('floating', 'paper'),
        animated,
      ]}
    >
      <View
        style={[
          styles.body,
          { backgroundColor: palette.bg },
          innerHighlight('rgba(255,255,255,0.16)'),
        ]}
      >
        <Text style={[text.bodySm, { color: palette.fg }]} numberOfLines={2}>
          {item.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    // Toasts sit above modals; this is one of the few systemic z-index layers.
    zIndex: 100,
  },
  body: {
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
