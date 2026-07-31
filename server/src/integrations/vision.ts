import { config } from '../config';
import { logger } from '../logger';

/**
 * Server-side photo analysis — the anti-cheat checkpoint and the source of every
 * composition/pose/rarity signal (README sections 2 and 9.1 step 6).
 *
 * DECISION (README open item): Google Cloud Vision over AWS Rekognition.
 *
 *  - Accuracy on the thing we actually need is comparable; both label a domestic cat
 *    reliably. Vision's label taxonomy is finer on coat/breed terms ("calico",
 *    "tortoiseshell"), which the rarity detector consumes directly.
 *  - Vision bills roughly $1.50 per 1,000 images for LABEL_DETECTION after a 1,000/month
 *    free tier; Rekognition is roughly $1.00 per 1,000 after 5,000/month free for 12
 *    months. Rekognition is marginally cheaper at volume, but at MVP volume (a few
 *    thousand submissions/month) both are single-digit dollars, so price is not the
 *    tie-breaker.
 *  - One annotate call returns labels, object boxes, dominant colours and crop hints
 *    together — every composition signal in a single billable request. Rekognition needs
 *    several.
 *  - The API-key auth path avoids pulling in the AWS SDK and an IAM role for one call.
 *
 * Verify current pricing before launch — these figures move.
 */

export interface BoundingBox {
  /** Normalised 0-1 against the frame. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionAnalysis {
  isCat: boolean;
  /** Highest confidence across cat-ish labels and object boxes. */
  confidence: number;
  /** Every label and object name returned, lowercased. */
  labels: string[];
  /** Labels with their scores, for signals that care how sure Vision was. */
  scoredLabels: { description: string; score: number }[];
  /** Box of the highest-confidence cat. Null when only a label matched, with no box. */
  subject: BoundingBox | null;
  /** How many distinct cats were localised. Drives the multiple-cats bonus. */
  catCount: number;
  /** Mean luminance 0-1 from dominant colours. Null when unavailable. */
  luminance: number | null;
  /** Spread of dominant-colour saturation 0-1, a rough colourfulness measure. */
  colourfulness: number | null;
  /** Vision's own confidence that its suggested crop is good, 0-1. */
  cropConfidence: number | null;
  /** True when the image looks like a photo of a screen or printed picture. */
  likelySpoofed: boolean;
  provider: 'google' | 'aws' | 'bypass';
}

const CAT_LABELS = [
  'cat',
  'kitten',
  'felidae',
  'domestic short-haired cat',
  'whiskers',
  'small to medium-sized cats',
];

/**
 * Anti-spoofing heuristic. A photo of a photo tends to get labelled with the medium
 * rather than only the subject. This is a cheap first pass, not a liveness check —
 * a determined cheater beats it, which is why submission rate limits also exist.
 */
const SPOOF_LABELS = [
  'screenshot',
  'computer monitor',
  'display device',
  'television',
  'mobile phone',
  'laptop',
  'screen',
  'poster',
  'picture frame',
  'photograph',
  'printing',
  'magazine',
  'illustration',
  'drawing',
  'cartoon',
  'anime',
  'painting',
];

export async function analyzePhoto(photoBase64: string): Promise<VisionAnalysis> {
  if (config.VISION_DEV_BYPASS) {
    logger.warn('VISION_DEV_BYPASS is on — scoring without verification');
    return devBypassAnalysis();
  }

  if (config.VISION_PROVIDER === 'google') {
    return analyzeWithGoogle(photoBase64);
  }

  // Rekognition path is intentionally unimplemented — the decision above selected Google.
  // Left as an explicit failure rather than a silent pass so switching providers is a
  // deliberate act.
  throw new Error(
    'VISION_PROVIDER=aws is not implemented. Google Cloud Vision is the selected provider.'
  );
}

/**
 * Deterministic-ish stand-in for local development without a billed key. It varies a
 * little so the reveal animation and tier thresholds can be exercised, but it is never
 * reachable in production — config.ts refuses to boot with the bypass on.
 */
function devBypassAnalysis(): VisionAnalysis {
  const poses = ['yawning', 'jumping', 'grooming', 'sleeping', 'sitting', 'stretching'];
  const coats = ['tabby', 'calico', 'tuxedo', 'ginger', 'siamese'];
  const pose = poses[Math.floor(Math.random() * poses.length)];
  const coat = coats[Math.floor(Math.random() * coats.length)];

  return {
    isCat: true,
    confidence: 0.95,
    labels: ['cat', coat, pose, 'whiskers'],
    scoredLabels: [
      { description: 'cat', score: 0.95 },
      { description: coat, score: 0.8 },
      { description: pose, score: 0.72 },
    ],
    subject: { x: 0.28, y: 0.24, width: 0.44, height: 0.5 },
    catCount: 1,
    luminance: 0.5 + (Math.random() - 0.5) * 0.3,
    colourfulness: 0.4,
    cropConfidence: 0.7,
    likelySpoofed: false,
    provider: 'bypass',
  };
}

async function analyzeWithGoogle(photoBase64: string): Promise<VisionAnalysis> {
  if (!config.GOOGLE_VISION_API_KEY) {
    throw new Error('GOOGLE_VISION_API_KEY is not configured');
  }

  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${config.GOOGLE_VISION_API_KEY}`;

  const controller = new AbortController();
  // A hung Vision call must not hold the player's submission open indefinitely.
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        requests: [
          {
            image: { content: photoBase64 },
            features: [
              { type: 'LABEL_DETECTION', maxResults: 30 },
              { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
              { type: 'IMAGE_PROPERTIES' },
              { type: 'CROP_HINTS' },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, 'vision request failed');
      throw new Error(`Vision API returned ${response.status}`);
    }

    const json = (await response.json()) as GoogleAnnotateResponse;
    return parseGoogleResponse(json);
  } finally {
    clearTimeout(timeout);
  }
}

interface GoogleVertex {
  x?: number;
  y?: number;
}

interface GoogleAnnotateResponse {
  responses?: {
    labelAnnotations?: { description: string; score: number }[];
    localizedObjectAnnotations?: {
      name: string;
      score: number;
      boundingPoly?: { normalizedVertices?: GoogleVertex[] };
    }[];
    imagePropertiesAnnotation?: {
      dominantColors?: {
        colors?: {
          color?: { red?: number; green?: number; blue?: number };
          score?: number;
          pixelFraction?: number;
        }[];
      };
    };
    cropHintsAnnotation?: { cropHints?: { confidence?: number }[] };
    error?: { message?: string };
  }[];
}

/** Exported for the unit-testable path — parsing is where the subtle bugs live. */
export function parseGoogleResponse(json: GoogleAnnotateResponse): VisionAnalysis {
  const first = json.responses?.[0] ?? {};

  if (first.error?.message) {
    throw new Error(`Vision API error: ${first.error.message}`);
  }

  const labelAnnotations = first.labelAnnotations ?? [];
  const objects = first.localizedObjectAnnotations ?? [];

  const scoredLabels = [
    ...labelAnnotations.map((l) => ({
      description: l.description.toLowerCase(),
      score: l.score,
    })),
    ...objects.map((o) => ({ description: o.name.toLowerCase(), score: o.score })),
  ];

  const labels = scoredLabels.map((l) => l.description);

  const catObjects = objects.filter((o) =>
    CAT_LABELS.some((c) => o.name.toLowerCase().includes(c))
  );
  const catLabelMatches = scoredLabels.filter((l) =>
    CAT_LABELS.some((c) => l.description.includes(c))
  );

  const confidence = catLabelMatches.reduce((max, l) => Math.max(max, l.score), 0);

  // Prefer the largest cat box as the subject: with two cats in frame, the one that
  // fills more of the shot is the one the player framed.
  const boxes = catObjects
    .map((o) => toBox(o.boundingPoly?.normalizedVertices))
    .filter((b): b is BoundingBox => b !== null);

  const subject =
    boxes.length > 0
      ? boxes.reduce((best, b) => (b.width * b.height > best.width * best.height ? b : best))
      : null;

  const colours = first.imagePropertiesAnnotation?.dominantColors?.colors ?? [];
  const { luminance, colourfulness } = colourStats(colours);

  const cropConfidence = first.cropHintsAnnotation?.cropHints?.[0]?.confidence ?? null;

  const likelySpoofed = SPOOF_LABELS.some((s) => labels.some((l) => l.includes(s)));

  return {
    isCat: catLabelMatches.length > 0,
    confidence,
    labels,
    scoredLabels,
    subject,
    catCount: catObjects.length,
    luminance,
    colourfulness,
    cropConfidence,
    likelySpoofed,
    provider: 'google',
  };
}

function toBox(vertices: GoogleVertex[] | undefined): BoundingBox | null {
  if (!vertices || vertices.length < 4) return null;

  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;

  if (width <= 0 || height <= 0) return null;

  return { x: minX, y: minY, width, height };
}

/**
 * Mean luminance and saturation spread, weighted by how much of the frame each dominant
 * colour covers. Rec. 709 coefficients — a green-dominant photo and a blue-dominant one
 * at the same RGB average do not read as equally bright to the eye.
 */
function colourStats(
  colours: {
    color?: { red?: number; green?: number; blue?: number };
    pixelFraction?: number;
  }[]
): { luminance: number | null; colourfulness: number | null } {
  if (colours.length === 0) return { luminance: null, colourfulness: null };

  let weightSum = 0;
  let lumSum = 0;
  let satSum = 0;

  for (const entry of colours) {
    const weight = entry.pixelFraction ?? 0;
    if (weight <= 0) continue;

    const r = (entry.color?.red ?? 0) / 255;
    const g = (entry.color?.green ?? 0) / 255;
    const b = (entry.color?.blue ?? 0) / 255;

    lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * weight;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    satSum += (max === 0 ? 0 : (max - min) / max) * weight;

    weightSum += weight;
  }

  if (weightSum === 0) return { luminance: null, colourfulness: null };

  return { luminance: lumSum / weightSum, colourfulness: satSum / weightSum };
}
