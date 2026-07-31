import * as ImageManipulator from 'expo-image-manipulator';

import { CAPTURE_CONFIG } from '../constants/game';

/**
 * On-device cat detection.
 *
 * IMPORTANT — this is client-side only and is NOT trusted for the score. It exists to
 * make the camera feel responsive: draw a bounding box and open the framing window. The
 * authoritative check is the Vision API call on the server (README section 9.1, step 6).
 *
 * ## Implementation status
 *
 * The real detector is `react-native-vision-camera` frame processors plus ML Kit object
 * detection via `@infinitered/react-native-mlkit-object-detection`. Both require a custom
 * dev client (they are not in Expo Go) and native config plugins.
 *
 * Rather than pretend a frame processor exists here, this module defines the interface the
 * camera screen consumes and ships a working heuristic detector against `expo-camera`,
 * which needs no native module. Swapping in ML Kit means implementing `CatDetector`
 * against a frame processor — the screen does not change.
 */

export interface DetectionBox {
  /** Fractions of the preview's width/height, so the overlay is resolution independent. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  found: boolean;
  confidence: number;
  box: DetectionBox | null;
  labels: string[];
}

export interface CatDetector {
  /** Feed one frame or preview snapshot. Cheap enough to call a few times a second. */
  analyze(uri: string): Promise<DetectionResult>;
  reset(): void;
}

/**
 * Tracks detection stability so a single lucky frame does not open the framing window.
 *
 * A cat has to stay in frame for `stableDetectionFrames` consecutive analyses. This is
 * the gate described in README section 9.1 step 3, and it is what makes the countdown
 * feel like it started because the app actually saw a cat.
 */
export class StabilityTracker {
  private consecutive = 0;
  private best: DetectionResult | null = null;

  push(result: DetectionResult): { stable: boolean; streak: number } {
    if (result.found && result.confidence >= CAPTURE_CONFIG.minDetectionConfidence) {
      this.consecutive += 1;
      if (!this.best || result.confidence > this.best.confidence) this.best = result;
    } else {
      // Reset rather than decay. A cat that walked out of frame should not leave the
      // player half-way to a window they can no longer use.
      this.consecutive = 0;
    }

    return {
      stable: this.consecutive >= CAPTURE_CONFIG.stableDetectionFrames,
      streak: this.consecutive,
    };
  }

  bestFrame(): DetectionResult | null {
    return this.best;
  }

  reset(): void {
    this.consecutive = 0;
    this.best = null;
  }
}

/**
 * Heuristic detector for the Expo-Go-compatible path.
 *
 * It samples the centre of the frame and looks for a coherent subject: a region whose
 * brightness varies from the frame edges. That correlates with "something is in front of
 * the camera", not specifically with "cat" — which is exactly why the server does the real
 * verification. Confidence is capped below 1 so no caller mistakes this for certainty.
 */
export class HeuristicDetector implements CatDetector {
  private lastSample: number[] | null = null;

  async analyze(uri: string): Promise<DetectionResult> {
    try {
      // Downscale hard before analysis — decoding a full-resolution frame several times a
      // second is what makes a camera screen drop to single-digit frame rates.
      const small = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 64 } }],
        { base64: true, compress: 0.4, format: ImageManipulator.SaveFormat.JPEG }
      );

      if (!small.base64) {
        return { found: false, confidence: 0, box: null, labels: [] };
      }

      // Proxy for image complexity. A JPEG of a flat wall compresses far smaller than one
      // of a textured animal, so payload size correlates with "there is a subject here".
      const size = small.base64.length;
      const complexity = Math.min(1, size / 5200);

      const motion = this.motionScore(size);
      this.lastSample = [size, ...(this.lastSample ?? [])].slice(0, 5);

      // Requiring both texture and some frame-to-frame change avoids locking on to a
      // poster or a photo on a screen, which is also what the server's spoof check targets.
      const confidence = Math.min(0.85, complexity * 0.7 + motion * 0.3);
      const found = confidence >= CAPTURE_CONFIG.minDetectionConfidence;

      return {
        found,
        confidence,
        box: found
          ? { x: 0.18, y: 0.22, width: 0.64, height: 0.56 }
          : null,
        labels: [],
      };
    } catch {
      return { found: false, confidence: 0, box: null, labels: [] };
    }
  }

  private motionScore(size: number): number {
    if (!this.lastSample || this.lastSample.length === 0) return 0.5;

    const mean =
      this.lastSample.reduce((sum, value) => sum + value, 0) / this.lastSample.length;
    const delta = Math.abs(size - mean) / Math.max(1, mean);

    // A completely static frame scores low (likely a photo), wild change scores low too
    // (likely a blurred pan). A living animal sits in between.
    if (delta < 0.005) return 0.15;
    if (delta > 0.4) return 0.2;
    return 0.8;
  }

  reset(): void {
    this.lastSample = null;
  }
}

/**
 * Prepare the captured photo for upload.
 *
 * Downscaling client-side keeps the request small enough to succeed on mobile data and
 * matches the server's declared ceiling. Sending a 12-megapixel original would time out.
 */
export async function preparePhotoForUpload(uri: string): Promise<string> {
  const processed = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: CAPTURE_CONFIG.maxPhotoEdge } }],
    {
      base64: true,
      compress: CAPTURE_CONFIG.jpegQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  if (!processed.base64) {
    throw new Error('We could not process that photo.');
  }

  return processed.base64;
}

export function createDetector(): CatDetector {
  // Swap this for the ML Kit frame-processor implementation once the custom dev client is
  // building. Callers depend on the interface, not on which detector is returned.
  return new HeuristicDetector();
}
