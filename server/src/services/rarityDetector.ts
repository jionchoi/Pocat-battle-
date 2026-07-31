import {
  CAT_RARITY,
  COAT_RARITY,
  POSE_CONFIDENCE_FLOOR,
  POSE_RARITY,
  clamp,
  type PoseClass,
} from '../game/rules';

/**
 * Turns Vision labels into the two "what is this cat doing / what kind of cat is it"
 * signals the scoring engine needs.
 *
 * Honest scope note: Google Vision does not ship a cat-pose classifier. What it does
 * return is a broad label set that frequently includes action and posture words ("yawn",
 * "jumping", "sleep", "grooming"). This module maps those to our pose classes by keyword.
 * It is a coarse proxy and it will miss subtle poses — which is exactly why README
 * section 2 puts a custom-trained pose classifier in Phase 2. The interface here is the
 * seam that swap happens behind: replace `classifyPose` and nothing else changes.
 */

/** Keyword → pose class. Longer, more specific keys are matched first. */
const POSE_KEYWORDS: { keywords: string[]; pose: PoseClass }[] = [
  { pose: 'yawning', keywords: ['yawn', 'open mouth', 'hiss', 'meow', 'mouth open'] },
  { pose: 'jumping', keywords: ['jumping', 'jump', 'leap', 'mid-air', 'airborne', 'flight'] },
  { pose: 'pouncing', keywords: ['pounce', 'hunting', 'stalking', 'attack', 'play fight'] },
  { pose: 'stretching', keywords: ['stretch', 'yoga', 'arch'] },
  { pose: 'grooming', keywords: ['grooming', 'licking', 'washing', 'cleaning', 'tongue'] },
  { pose: 'sleeping', keywords: ['sleep', 'nap', 'resting', 'eyes closed', 'dozing', 'curled'] },
  { pose: 'loafing', keywords: ['loaf', 'bread', 'tucked', 'crouching'] },
  { pose: 'walking', keywords: ['walking', 'walk', 'prowl', 'stride', 'running', 'gait'] },
  { pose: 'sitting', keywords: ['sitting', 'sit', 'seated', 'perched'] },
  { pose: 'standing', keywords: ['standing', 'stand'] },
];

export interface PoseVerdict {
  pose: PoseClass;
  confidence: number;
  /** 0-100, already scaled by confidence. */
  score: number;
}

export function classifyPose(scoredLabels: { description: string; score: number }[]): PoseVerdict {
  // The keyword table is ordered by how interesting the pose is, so the first entry
  // with any match wins — a photo labelled both "sitting" and "yawning" is a yawn,
  // because the yawn is the moment the player was actually waiting for.
  for (const entry of POSE_KEYWORDS) {
    const matches = scoredLabels.filter((label) =>
      entry.keywords.some((keyword) => label.description.includes(keyword))
    );

    if (matches.length === 0) continue;

    // Within one pose class, take the most confident label that produced the match.
    const confidence = matches.reduce((max, label) => Math.max(max, label.score), 0);

    return {
      pose: entry.pose,
      confidence,
      score: poseScore(entry.pose, confidence),
    };
  }

  return { pose: 'unknown', confidence: 0, score: POSE_RARITY.unknown };
}

/**
 * A low-confidence detection is pulled toward the `unknown` baseline, not toward zero:
 * a maybe-yawn should still beat a confident sit, because the downside of under-rewarding
 * a genuinely funny shot is worse than the downside of over-rewarding a boring one.
 */
export function poseScore(pose: PoseClass, confidence: number): number {
  const base = POSE_RARITY[pose];
  const baseline = POSE_RARITY.unknown;

  if (confidence >= 1) return base;

  const weight = clamp(
    (confidence - POSE_CONFIDENCE_FLOOR) / (1 - POSE_CONFIDENCE_FLOOR),
    0,
    1
  );

  return Math.round(baseline + (base - baseline) * weight);
}

export interface CoatVerdict {
  /** 0-100 scarcity of the coat/breed itself, before encounter adjustments. */
  coatScore: number;
  /** The labels that matched, kept on the Cat record so re-matching is comparable. */
  coatLabels: string[];
  breedGuess: string | null;
}

export function detectCoat(labels: string[]): CoatVerdict {
  const matched: { label: string; score: number }[] = [];

  for (const [coat, score] of Object.entries(COAT_RARITY)) {
    if (labels.some((l) => l.includes(coat))) matched.push({ label: coat, score });
  }

  if (matched.length === 0) {
    return { coatScore: CAT_RARITY.unknownCoat, coatLabels: [], breedGuess: null };
  }

  // The rarest match wins: a photo labelled both "cat" and "sphynx" is a sphynx, and the
  // generic label should not average that away.
  const rarest = matched.reduce((a, b) => (b.score > a.score ? b : a));

  return {
    coatScore: rarest.score,
    coatLabels: matched.map((m) => m.label),
    breedGuess: titleCase(rarest.label),
  };
}

/**
 * Final cat-rarity component (README 9.2): coat scarcity, plus a bonus for being the
 * first person anywhere to photograph this animal, minus a bounded penalty as the cat
 * becomes a known local face.
 */
export function catRarityScore(params: {
  coatScore: number;
  isFirstDiscovery: boolean;
  globalEncounterCount: number;
}): number {
  const familiarity = Math.min(
    CAT_RARITY.maxFamiliarityPenalty,
    Math.max(0, params.globalEncounterCount - 1) * CAT_RARITY.familiarityPenaltyPer
  );

  const discovery = params.isFirstDiscovery ? CAT_RARITY.firstDiscoveryBonus : 0;

  return clamp(Math.round(params.coatScore + discovery - familiarity), 0, 100);
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
