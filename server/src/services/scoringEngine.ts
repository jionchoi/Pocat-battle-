import {
  BADGE_LIMIT,
  BADGE_RULES,
  BONUS,
  COMPOSITION_WEIGHTS,
  FRAMING,
  LIGHTING,
  LIGHT_WINDOWS,
  UNUSUAL_LOCATION_LABELS,
  clamp,
  compositeTotal,
  ramp,
  tierFor,
  type BadgeContext,
  type PoseClass,
  type Rarity,
} from '../game/rules';
import type { BoundingBox, VisionAnalysis } from '../integrations/vision';
import { clampScore, solarHourAt, type ImageSignals } from './imageSignals';
import { catRarityScore, classifyPose, detectCoat } from './rarityDetector';

/**
 * The composite scorer (README 9.2). Every number a player sees on the Score Result
 * screen is produced here, on the server, from signals the client cannot forge.
 *
 * The client sends a photo and a location. It does not send — and could not usefully
 * send — a score. That is the whole anti-cheat position: there is nothing to tamper with
 * because the client never computes anything that matters.
 */

export interface ScoreInput {
  vision: VisionAnalysis;
  image: ImageSignals;
  lat: number;
  lng: number;
  capturedAt: Date;
  isFirstDiscovery: boolean;
  /** Encounters of this cat across all players, before this one. */
  globalEncounterCount: number;
  /** This player's encounters with this cat, before this one. */
  playerEncounterCount: number;
}

export interface CompositionBreakdown {
  framing: number;
  focus: number;
  lighting: number;
  total: number;
}

export interface ScoreResult {
  composition: number;
  poseRarity: number;
  catRarity: number;
  bonus: number;
  total: number;
  tier: Rarity;
  pose: PoseClass;
  poseConfidence: number;
  badges: string[];
  title: string;
  breedGuess: string | null;
  coatLabels: string[];
  coatScore: number;
  /** Exposed so the Score Result screen can explain where composition came from. */
  compositionDetail: CompositionBreakdown;
  bonusReasons: string[];
}

export function scorePhoto(input: ScoreInput): ScoreResult {
  const { vision, image } = input;

  const compositionDetail = scoreComposition(vision, image);
  const poseVerdict = classifyPose(vision.scoredLabels);
  const coat = detectCoat(vision.labels);

  const catRarity = catRarityScore({
    coatScore: coat.coatScore,
    isFirstDiscovery: input.isFirstDiscovery,
    globalEncounterCount: input.globalEncounterCount,
  });

  const { bonus, reasons, goldenHour, unusualLocation } = scoreBonus(input);

  const parts = {
    composition: compositionDetail.total,
    poseRarity: poseVerdict.score,
    catRarity,
    bonus,
  };

  const total = compositeTotal(parts);

  const badgeContext: BadgeContext = {
    ...parts,
    total,
    pose: poseVerdict.pose,
    isNewCat: input.isFirstDiscovery,
    // +1 because this capture is itself an encounter.
    encounterCount: input.playerEncounterCount + 1,
    goldenHour,
    catCount: vision.catCount,
    unusualLocation,
  };

  const badges = BADGE_RULES.filter((rule) => rule.when(badgeContext))
    .slice(0, BADGE_LIMIT)
    .map((rule) => rule.label);

  return {
    ...parts,
    total,
    tier: tierFor(total),
    pose: poseVerdict.pose,
    poseConfidence: poseVerdict.confidence,
    badges,
    title: buildTitle(badgeContext, coat.breedGuess),
    breedGuess: coat.breedGuess,
    coatLabels: coat.coatLabels,
    coatScore: coat.coatScore,
    compositionDetail,
    bonusReasons: reasons,
  };
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

export function scoreComposition(
  vision: VisionAnalysis,
  image: ImageSignals
): CompositionBreakdown {
  const framing = scoreFraming(vision.subject, vision.cropConfidence);
  const focus = image.focusScore;
  const lighting = scoreLighting(vision.luminance, vision.colourfulness);

  const total = clampScore(
    framing * COMPOSITION_WEIGHTS.framing +
      focus * COMPOSITION_WEIGHTS.focus +
      lighting * COMPOSITION_WEIGHTS.lighting
  );

  return { framing, focus, lighting, total };
}

/**
 * Framing = is the cat a sensible size in the frame, and is it well placed.
 *
 * With no bounding box we fall back to Vision's crop-hint confidence, which is a weaker
 * but real signal about whether the shot has a clear subject at all.
 */
export function scoreFraming(
  subject: BoundingBox | null,
  cropConfidence: number | null
): number {
  if (!subject) {
    return cropConfidence === null ? 55 : clampScore(35 + cropConfidence * 45);
  }

  const area = clamp(subject.width * subject.height, 0, 1);

  // Ramps up to the ideal, then back down as the cat outgrows the frame. Asymmetric on
  // purpose: too small is a worse photo than too tight.
  const areaScore =
    area <= FRAMING.idealSubjectArea
      ? ramp(area, FRAMING.toleratedMin, FRAMING.idealSubjectArea)
      : 100 - ramp(area, FRAMING.idealSubjectArea, FRAMING.toleratedMax) * 0.65;

  const placementScore = scorePlacement(subject);

  return clampScore(
    areaScore * FRAMING.areaWeight + placementScore * FRAMING.placementWeight
  );
}

/**
 * Rule of thirds. Distance from the nearest thirds intersection to the subject's centre,
 * ramped down to zero at `thirdsFalloff`.
 *
 * Dead centre is roughly 0.24 units from an intersection, which lands mid-scale — a
 * centred cat is a fine photo, just not a composed one. Scoring it at zero would punish
 * the most natural way to point a phone at an animal that is about to leave.
 */
export function scorePlacement(subject: BoundingBox): number {
  const cx = subject.x + subject.width / 2;
  const cy = subject.y + subject.height / 2;

  const thirds = [1 / 3, 2 / 3];
  let nearest = Infinity;

  for (const tx of thirds) {
    for (const ty of thirds) {
      nearest = Math.min(nearest, Math.hypot(cx - tx, cy - ty));
    }
  }

  return clampScore(100 - ramp(nearest, 0, FRAMING.thirdsFalloff));
}

/** Exposure quality, plus a small lift for a colourful photo. */
export function scoreLighting(
  luminance: number | null,
  colourfulness: number | null
): number {
  if (luminance === null) return LIGHTING.unknownScore;

  const distance = Math.abs(luminance - LIGHTING.idealLuminance);
  const exposure = clampScore(100 - ramp(distance, 0, LIGHTING.falloff));

  const colour = (colourfulness ?? 0) * LIGHTING.saturationBonusMax;

  return clampScore(exposure * 0.88 + colour);
}

/* -------------------------------------------------------------------------- */
/* Bonus modifiers                                                            */
/* -------------------------------------------------------------------------- */

export function scoreBonus(input: ScoreInput): {
  bonus: number;
  reasons: string[];
  goldenHour: boolean;
  unusualLocation: boolean;
} {
  const reasons: string[] = [];
  let bonus = 0;

  const hour = solarHourAt(input.lng, input.capturedAt);
  const inWindow = (w: readonly [number, number]) => hour >= w[0] && hour < w[1];

  const goldenHour =
    inWindow(LIGHT_WINDOWS.goldenHourMorning) || inWindow(LIGHT_WINDOWS.goldenHourEvening);
  const blueHour =
    inWindow(LIGHT_WINDOWS.blueHourMorning) || inWindow(LIGHT_WINDOWS.blueHourEvening);

  if (goldenHour) {
    bonus += BONUS.goldenHour;
    reasons.push('Golden hour light');
  } else if (blueHour) {
    bonus += BONUS.blueHour;
    reasons.push('Blue hour light');
  }

  if (input.vision.catCount >= 2) {
    const extra = Math.max(0, input.vision.catCount - 2) * BONUS.perExtraCat;
    bonus += Math.min(BONUS.multipleCatsMax, BONUS.multipleCats + extra);
    reasons.push(`${input.vision.catCount} cats in frame`);
  }

  const unusualLocation = UNUSUAL_LOCATION_LABELS.some((l) =>
    input.vision.labels.some((label) => label.includes(l))
  );

  if (unusualLocation) {
    bonus += BONUS.unusualLocation;
    reasons.push('Unusual spot');
  }

  return { bonus: Math.min(BONUS.max, bonus), reasons, goldenHour, unusualLocation };
}

/* -------------------------------------------------------------------------- */
/* Title                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The photo's title (README 5.2 — "Golden Hour Ginger"): a modifier drawn from the
 * photo's standout property, plus a noun drawn from the cat itself.
 */
export function buildTitle(context: BadgeContext, breedGuess: string | null): string {
  const noun = breedGuess ?? 'Cat';

  if (context.pose === 'jumping' || context.pose === 'pouncing') return `Airborne ${noun}`;
  if (context.pose === 'yawning') return `Wide-Mouthed ${noun}`;
  if (context.pose === 'stretching') return `Long ${noun}`;
  if (context.pose === 'sleeping') return `Sleeping ${noun}`;
  if (context.pose === 'loafing') return `${noun} Loaf`;
  if (context.pose === 'grooming') return `Fastidious ${noun}`;
  if (context.goldenHour) return `Golden Hour ${noun}`;
  if (context.unusualLocation) return `Misplaced ${noun}`;
  if (context.catCount >= 2) return `${noun} and Company`;
  if (context.composition >= 85) return `Well-Framed ${noun}`;
  if (context.isNewCat) return `New ${noun}`;

  return `Neighborhood ${noun}`;
}
