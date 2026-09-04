import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
 *
 * ## The one exception: an action
 *
 * A toast may carry a single action, and it is a **way onward**, never a way back. Its one
 * caller is the out-of-paws toast, which routes to the shop: the player has hit a wall, and
 * naming the wall without naming the door is the kind of dead end a toast is otherwise good
 * at producing.
 *
 * It is deliberately not an undo. Paws cannot be taken back — see `usePawGift` — and any
 * future action here should meet the same bar: it must be optional, and missing it must cost
 * the player nothing. A toast disappears, so anything a player *must* do belongs in an inline
 * error or a sheet, and anything they cannot afford to miss belongs nowhere near one.
 */

export type ToastTone = 'success' | 'error' | 'neutral';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Overrides the default dwell. Anything carrying an action needs longer to be read. */
  durationMs?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs?: number;
}

type Listener = (item: ToastItem) => void;

let listener: Listener | null = null;
let nextId = 1;

/** How long a toast with nothing to press stays up. */
const DEFAULT_DURATION = 3_200;

/** Imperative, because a catch result or a failed save can fire from anywhere. */
export function showToast(
  message: string,
  tone: ToastTone = 'neutral',
  options: ToastOptions = {}
): void {
  listener?.({
    id: nextId++,
    message,
    tone,
    action: options.action,
    durationMs: options.durationMs,
  });
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

    const timer = setTimeout(hide, item.durationMs ?? DEFAULT_DURATION);
    return () => clearTimeout(timer);
  }, [hide, item, progress, reduceMotion]);

  /**
   * The action fires and the toast goes, in that order.
   *
   * Dismissing first would leave the caller's handler running with nothing on screen saying
   * it was asked for, and an undo that appears to do nothing is worse than no undo.
   */
  const act = useCallback(() => {
    item?.action?.onPress();
    hide();
  }, [hide, item]);

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
      /*
        `box-none` while there is something to press, so the action receives touches and the
        rest of the toast does not swallow taps meant for the screen underneath it. Without an
        action this is inert, exactly as it always was.
      */
      pointerEvents={item.action ? 'box-none' : 'none'}
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
        pointerEvents={item.action ? 'box-none' : 'none'}
        style={[
          styles.body,
          { backgroundColor: palette.bg },
          innerHighlight('rgba(255,255,255,0.16)'),
        ]}
      >
        <Text style={[text.bodySm, styles.message, { color: palette.fg }]} numberOfLines={2}>
          {item.message}
        </Text>

        {/*
          The separator is drawn rather than written into the message, so the label is a real
          control and the line still reads as one sentence: "You are out of paws · Shop".
        */}
        {item.action ? (
          <>
            <Text style={[text.bodySm, { color: palette.fg, opacity: 0.5 }]}>·</Text>
            <Pressable
              onPress={act}
              accessibilityRole="button"
              accessibilityLabel={item.action.label}
              hitSlop={spacing.sm}
              style={styles.action}
            >
              <Text style={[text.bodySm, styles.actionLabel, { color: palette.fg }]}>
                {item.action.label}
              </Text>
            </Pressable>
          </>
        ) : null}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  /**
   * The message takes the room and the action keeps its own.
   *
   * `flexShrink` rather than `flex: 1`: a short message should not push the action to the far
   * edge of the screen, where it is a separate object rather than the end of the sentence.
   */
  message: {
    flexShrink: 1,
  },
  action: {
    paddingVertical: 2,
  },
  actionLabel: {
    textDecorationLine: 'underline',
  },
});
