import { create } from 'zustand';

import type { GeoPoint, ScoredCapture, SubmissionRejectionReason } from '../models';

/**
 * Capture and framing-window state.
 *
 * Deliberately ephemeral and never persisted (README section 10): this is a short-lived
 * UI interaction, not durable state. A framing window that survived an app restart would
 * be meaningless — the cat is gone.
 *
 * The phases map exactly to what the player sees:
 *
 *   scanning  -> camera is live, no stable detection yet
 *   framing   -> a cat is held in frame; the countdown ring is running. THE skill moment.
 *   capturing -> shutter fired, image being processed and uploaded
 *   scoring   -> waiting on the server's verdict
 *   revealed  -> the Score Result screen owns the state
 *   rejected  -> the server declined; the reason drives the copy
 */

export type CapturePhase =
  | 'scanning'
  | 'framing'
  | 'capturing'
  | 'scoring'
  | 'revealed'
  | 'rejected';

export interface DetectionBox {
  /** Normalised 0-1 against the preview. */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CaptureState {
  phase: CapturePhase;
  /** Latest on-device detection box, for the overlay. Null when nothing is detected. */
  box: DetectionBox | null;
  confidence: number;
  /** Milliseconds left in the framing window. Drives the countdown ring. */
  remainingMs: number;
  /** How long the player held the window before shooting — advisory telemetry only. */
  heldMs: number;
  autoCaptured: boolean;
  location: GeoPoint | null;

  result: ScoredCapture | null;
  rejection: { reason: SubmissionRejectionReason; message: string } | null;

  setDetection: (box: DetectionBox | null, confidence: number) => void;
  beginFraming: () => void;
  tick: (remainingMs: number) => void;
  cancelFraming: () => void;
  beginCapture: (auto: boolean) => void;
  beginScoring: (location: GeoPoint) => void;
  succeed: (result: ScoredCapture) => void;
  reject: (reason: SubmissionRejectionReason, message: string) => void;
  reset: () => void;
}

const initial = {
  phase: 'scanning' as CapturePhase,
  box: null,
  confidence: 0,
  remainingMs: 0,
  heldMs: 0,
  autoCaptured: false,
  location: null,
  result: null,
  rejection: null,
};

export const useCaptureStore = create<CaptureState>((set, get) => ({
  ...initial,

  setDetection: (box, confidence) => {
    // Detection updates are ignored once the shutter has fired: the frame is already
    // committed, and letting a late detection move the overlay would be a lie.
    if (get().phase !== 'scanning' && get().phase !== 'framing') return;
    set({ box, confidence });
  },

  beginFraming: () => {
    if (get().phase !== 'scanning') return;
    set({ phase: 'framing', remainingMs: 0, heldMs: 0, autoCaptured: false });
  },

  tick: (remainingMs) => {
    if (get().phase !== 'framing') return;
    set({ remainingMs });
  },

  cancelFraming: () => {
    if (get().phase !== 'framing') return;
    set({ phase: 'scanning', remainingMs: 0, heldMs: 0 });
  },

  beginCapture: (auto) =>
    set({ phase: 'capturing', autoCaptured: auto, box: get().box }),

  beginScoring: (location) => set({ phase: 'scoring', location }),

  succeed: (result) => set({ phase: 'revealed', result, rejection: null }),

  reject: (reason, message) => set({ phase: 'rejected', rejection: { reason, message } }),

  reset: () => set({ ...initial }),
}));
