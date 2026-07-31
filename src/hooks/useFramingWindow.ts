import { useCallback, useEffect, useRef } from 'react';

import { CAPTURE_CONFIG } from '../constants/game';
import { useCaptureStore } from '../store/captureStore';

/**
 * The framing window — the actual skill moment of the game (README section 9.1, step 3).
 *
 * Once a cat has been stably detected the player gets a few seconds to wait for a better
 * pose before shooting. Waiting is the whole point: a mid-yawn scores far higher than a
 * sit, so the window rewards patience rather than reflex. If the player does not shoot,
 * it auto-captures at zero rather than losing the moment entirely.
 *
 * Two details matter more than they look:
 *
 *  - The countdown is driven off `Date.now()` deltas, not by decrementing a counter each
 *    tick. A dropped frame or a slow interval would otherwise silently lengthen the
 *    window, which is the one thing that must stay honest between players.
 *  - Losing detection does not cancel immediately. A blink or a head-turn drops a frame
 *    or two constantly; a grace period is what stops the ring resetting every time the
 *    cat moves.
 */

const TICK_MS = 50;

export interface FramingWindow {
  /** Milliseconds remaining, 0 when closed. */
  remainingMs: number;
  /** 0-1 progress through the window. Drives the countdown ring. */
  progress: number;
  active: boolean;
}

export function useFramingWindow(params: {
  /** True once the detector reports a stable cat in frame. */
  stable: boolean;
  /** True while a cat is currently detected — drives the grace-period cancel. */
  detected: boolean;
  /** Fired when the window expires without the player shooting. */
  onAutoCapture: () => void;
  /** Disabled once the shutter fires or the screen leaves. */
  enabled: boolean;
}) {
  const phase = useCaptureStore((s) => s.phase);
  const beginFraming = useCaptureStore((s) => s.beginFraming);
  const cancelFraming = useCaptureStore((s) => s.cancelFraming);
  const tick = useCaptureStore((s) => s.tick);

  const startedAt = useRef<number | null>(null);
  const lostSince = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Read inside the interval; props there would be a stale closure. */
  const onAutoCaptureRef = useRef(params.onAutoCapture);
  const firedRef = useRef(false);

  onAutoCaptureRef.current = params.onAutoCapture;

  /* Open the window as soon as detection is stable. */
  useEffect(() => {
    if (!params.enabled) return;
    if (phase !== 'scanning') return;
    if (!params.stable) return;

    startedAt.current = Date.now();
    lostSince.current = null;
    firedRef.current = false;
    beginFraming();
  }, [beginFraming, params.enabled, params.stable, phase]);

  /* Run the countdown. */
  useEffect(() => {
    if (phase !== 'framing' || !params.enabled) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }

    timer.current = setInterval(() => {
      const started = startedAt.current;
      if (started === null) return;

      const elapsed = Date.now() - started;
      const remaining = Math.max(0, CAPTURE_CONFIG.windowMs - elapsed);

      tick(remaining);

      if (remaining > 0) return;

      // Guarded because the interval can fire once more before the effect tears down,
      // and firing the shutter twice would submit the same moment twice.
      if (!firedRef.current && CAPTURE_CONFIG.autoCaptureAtEnd) {
        firedRef.current = true;
        onAutoCaptureRef.current();
      }
    }, TICK_MS);

    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [params.enabled, phase, tick]);

  /* Cancel the window if the cat genuinely leaves, after a grace period. */
  useEffect(() => {
    if (phase !== 'framing') {
      lostSince.current = null;
      return;
    }

    if (params.detected) {
      lostSince.current = null;
      return;
    }

    if (lostSince.current === null) {
      lostSince.current = Date.now();
      return;
    }

    if (Date.now() - lostSince.current >= CAPTURE_CONFIG.detectionLostGraceMs) {
      startedAt.current = null;
      lostSince.current = null;
      cancelFraming();
    }
  }, [cancelFraming, params.detected, phase]);

  /** Milliseconds the player held the window. Advisory telemetry, never a score input. */
  const heldMs = useCallback(() => {
    const started = startedAt.current;
    return started === null ? 0 : Date.now() - started;
  }, []);

  const remainingMs = useCaptureStore((s) => s.remainingMs);

  return {
    remainingMs,
    progress:
      phase === 'framing'
        ? 1 - Math.min(1, remainingMs / CAPTURE_CONFIG.windowMs)
        : 0,
    active: phase === 'framing',
    heldMs,
  };
}
