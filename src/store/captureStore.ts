import { create } from 'zustand';

import type { GeoPoint, ScoredCapture, SubmissionRejectionReason } from '../models';

/**
 * Capture state.
 *
 * Deliberately ephemeral and never persisted (README section 10): this is a short-lived UI
 * interaction, not durable state. A half-finished capture that survived an app restart would
 * be meaningless — the cat is gone.
 *
 * The phases map exactly to what the player sees:
 *
 *   scanning  -> camera is live, waiting for the player to decide
 *   capturing -> shutter fired, image being processed and uploaded
 *   scoring   -> waiting on the server's verdict
 *   revealed  -> the Score Result screen owns the state
 *   rejected  -> the server declined; the reason drives the copy
 *
 * `scanning` no longer means the phone is looking for anything. The on-device detector, the
 * framing window and the auto-capture that used to live between it and `capturing` are gone:
 * the player decides when the moment is right, and the shutter is the only thing that fires.
 */

export type CapturePhase =
  | 'scanning'
  | 'capturing'
  | 'scoring'
  | 'revealed'
  | 'rejected';

interface CaptureState {
  phase: CapturePhase;
  location: GeoPoint | null;

  /**
   * The on-device file the camera just wrote, full quality.
   *
   * The reveal shows this rather than waiting on the uploaded copy: it is the frame the
   * player watched themselves take, it is already on disk, and it needs no network. It is
   * also what "Save to my phone" writes to the library, so the file that reaches the
   * camera roll is the original rather than a re-download of the compressed upload.
   *
   * Ephemeral like the rest of this store — it points into the camera's cache directory,
   * which the OS is free to clear between launches.
   */
  localUri: string | null;

  /**
   * How far through the submission we actually are, 0..1.
   *
   * Set at the real milestones of `submit` — shutter, file written, image compressed,
   * request in flight, verdict — rather than by a timer. The scoring screen is allowed to
   * drift a little ahead of the last milestone so it never looks frozen, but it can never
   * pass one that has not happened. A progress bar that is pure animation is a lie the
   * player finds out about the first time the network is slow.
   */
  progress: number;

  result: ScoredCapture | null;
  rejection: { reason: SubmissionRejectionReason; message: string } | null;

  beginCapture: () => void;
  attachLocalPhoto: (uri: string) => void;
  /** Advances the submission meter. Never moves backwards within one capture. */
  advance: (progress: number) => void;
  beginScoring: (location: GeoPoint) => void;
  succeed: (result: ScoredCapture) => void;
  reject: (reason: SubmissionRejectionReason, message: string) => void;
  reset: () => void;
}

const initial = {
  phase: 'scanning' as CapturePhase,
  location: null,
  localUri: null,
  progress: 0,
  result: null,
  rejection: null,
};

/**
 * What each step of a submission is worth on the meter.
 *
 * Weighted by how long each step actually takes, not evenly: writing the file is quick,
 * the round trip to the scorer is most of the wait, so the bar spends most of its life
 * between `uploading` and `1`.
 */
export const CAPTURE_PROGRESS = {
  /** Shutter fired, camera still writing. */
  shutter: 0.08,
  /** The file exists on disk. */
  captured: 0.22,
  /** Resized and encoded, ready to send. */
  prepared: 0.4,
  /** Request in flight. */
  uploading: 0.52,
} as const;

export const useCaptureStore = create<CaptureState>((set, get) => ({
  ...initial,

  beginCapture: () =>
    set({
      phase: 'capturing',
      localUri: null,
      progress: CAPTURE_PROGRESS.shutter,
    }),

  attachLocalPhoto: (uri) =>
    set({ localUri: uri, progress: Math.max(get().progress, CAPTURE_PROGRESS.captured) }),

  advance: (progress) => set({ progress: Math.max(get().progress, progress) }),

  beginScoring: (location) =>
    set({ phase: 'scoring', location, progress: CAPTURE_PROGRESS.uploading }),

  succeed: (result) =>
    set({ phase: 'revealed', result, rejection: null, progress: 1 }),

  reject: (reason, message) => set({ phase: 'rejected', rejection: { reason, message } }),

  reset: () => set({ ...initial }),
}));
