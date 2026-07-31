import { useCallback, useEffect, useRef, useState } from 'react';

import { CAPTURE_CONFIG } from '../constants/game';
import {
  StabilityTracker,
  createDetector,
  type CatDetector,
  type DetectionResult,
} from '../services/catDetection';

/**
 * Live on-device detection loop for the capture camera.
 *
 * Client-side and advisory only — it decides when to draw a box and open the framing
 * window, never what a photo scores. The server does the real check.
 *
 * Unlike a one-shot gate, this keeps analysing after the window opens: the window has to
 * cancel if the cat leaves, so the loop cannot stop the moment it becomes stable.
 */

export interface DetectionState {
  result: DetectionResult | null;
  streak: number;
  stable: boolean;
  analyzing: boolean;
}

const ANALYSIS_INTERVAL_MS = 220;

export function useCatDetection(params: {
  /** Grabs a preview frame. Returns null when the camera is not ready. */
  captureFrame: () => Promise<string | null>;
  enabled: boolean;
}) {
  const [state, setState] = useState<DetectionState>({
    result: null,
    streak: 0,
    stable: false,
    analyzing: false,
  });

  const detector = useRef<CatDetector>(createDetector());
  const tracker = useRef(new StabilityTracker());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  /** Guards against overlapping analyses when one frame takes longer than the interval. */
  const busy = useRef(false);
  /** Read inside the loop; state would be a stale closure there. */
  const stableRef = useRef(false);

  const reset = useCallback(() => {
    tracker.current.reset();
    detector.current.reset();
    stableRef.current = false;
    setState({ result: null, streak: 0, stable: false, analyzing: false });
  }, []);

  useEffect(() => {
    mounted.current = true;

    if (!params.enabled) {
      if (timer.current) clearTimeout(timer.current);
      return () => {
        mounted.current = false;
      };
    }

    const tick = async () => {
      if (!mounted.current) return;

      // Overlapping analyses would queue up if one frame decode outlasts the interval.
      if (!busy.current) {
        busy.current = true;

        try {
          const uri = await params.captureFrame();

          if (uri && mounted.current) {
            const result = await detector.current.analyze(uri);
            const { stable, streak } = tracker.current.push(result);
            stableRef.current = stable;

            if (mounted.current) {
              setState({ result, streak, stable, analyzing: true });
            }
          }
        } catch {
          // A dropped frame is normal — the camera may be mid-focus or backgrounding.
        } finally {
          busy.current = false;
        }
      }

      // Keep going even once stable — the framing window needs to know if the cat
      // wanders off, and stopping here would freeze the overlay on a stale box.
      if (mounted.current) {
        timer.current = setTimeout(tick, ANALYSIS_INTERVAL_MS);
      }
    };

    void tick();

    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [params.enabled, params.captureFrame]);

  return {
    ...state,
    reset,
    bestConfidence: tracker.current.bestFrame()?.confidence ?? 0,
    framesRequired: CAPTURE_CONFIG.stableDetectionFrames,
  };
}
