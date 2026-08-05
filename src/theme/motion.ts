import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/**
 * Motion. MOTION_INTENSITY 6.
 *
 * No `linear`, no `ease-in-out`, no instant state change.
 *
 * Everything here targets Reanimated 3 worklets on the UI thread. RN's core `Animated`
 * API is deliberately unused — it crosses the bridge every frame and stutters badly
 * under camera-frame processing, which is exactly what the catch screen does.
 *
 * Hard constraint: animate `transform` and `opacity` only. Never `width`, `height`,
 * `top`, `left` or `flex` — those trigger layout on every frame.
 */

export const spring = {
  /** Taps, toggles, chips. Quick and firm. */
  snap: { stiffness: 220, damping: 24, mass: 0.9 } satisfies WithSpringConfig,
  /** Default. Layout changes, sheets, cards, the tab bar indicator. */
  soft: { stiffness: 100, damping: 20, mass: 1 } satisfies WithSpringConfig,
  /** Deliberate overshoot: badge pops, catch reveal, level-up, life-stage transition. */
  overshoot: { stiffness: 160, damping: 12, mass: 0.85 } satisfies WithSpringConfig,
} as const;

export const timing = {
  enter: {
    duration: 620,
    easing: Easing.bezier(0.32, 0.72, 0, 1),
  } satisfies WithTimingConfig,
  exit: {
    duration: 240,
    easing: Easing.bezier(0.4, 0, 1, 1),
  } satisfies WithTimingConfig,
  /** Context cross-fade between Paper and Arena. Never a hard cut. */
  contextSwitch: {
    duration: 600,
    easing: Easing.bezier(0.32, 0.72, 0, 1),
  } satisfies WithTimingConfig,
  /**
   * Collapsed target when reduce-motion is on. `linear` is the deliberate exception to
   * the no-linear-easing rule: this is a 120ms opacity crossfade with no perceived
   * travel, so an expressive curve would be motion the player asked not to see.
   */
  reduced: { duration: 120, easing: Easing.linear } satisfies WithTimingConfig,
} as const;

/** Per-index delay for staggered list and grid mounts. Nothing mounts all at once. */
export const STAGGER_MS = 60;

export function staggerDelay(index: number, cap = 10): number {
  return Math.min(index, cap) * STAGGER_MS;
}

/** Tactile press. Applied to every pressable, including map pins and tab items. */
export const press = {
  scale: 0.98,
  translateY: 1,
  config: spring.snap,
} as const;

/**
 * Button-in-button trailing icon. The icon well translates and scales up while the
 * parent button compresses — internal kinetic tension rather than a flat color change.
 */
export const iconWell = {
  size: 30,
  translateX: 2,
  translateY: -1,
  scale: 1.05,
  config: spring.snap,
} as const;

/**
 * Perpetual micro-interactions. The product must feel alive at rest.
 *
 * PERFORMANCE GATE: every loop below must live in its own `React.memo`'d leaf component
 * so it can never re-render a parent, and must pause when off-screen. In the Collection
 * grid, `raritySheen` runs on Legendary cards only and is gated by
 * `onViewableItemsChanged` — animating every card in a 200-card grid collapses the
 * frame rate.
 */
export const perpetual = {
  /** Map: user location dot. */
  breathe: { from: 1, to: 1.08, duration: 2400 },
  /** Map: active challenge location ring. */
  challengePulse: { from: 0.9, to: 1.14, duration: 1600 },
  /** Legendary cards only. A masked, translated highlight — never a shadow glow. */
  raritySheen: { duration: 6000, sweepDelay: 4200 },
  /** Score reveal: the total counting up before it settles. */
  scoreTally: { duration: 900 },
  /** Skeleton loaders. */
  skeletonSweep: { duration: 1400 },
} as const;

/**
 * Reduce-motion. Read once and threaded through the theme.
 *
 * When enabled: all perpetual loops stop, springs collapse to a 120ms fade, and the
 * score reveal shows its end state immediately. A player who needs reduced motion should
 * never have to sit through an animation to get their score.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });

    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value: boolean) => {
        if (mounted) setReduced(value);
      }
    );

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

export const motion = {
  spring,
  timing,
  press,
  iconWell,
  perpetual,
  staggerDelay,
  STAGGER_MS,
} as const;
