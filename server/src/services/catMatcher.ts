import { createHash } from 'node:crypto';

import type { Cat } from '@prisma/client';

import { prisma } from '../db/client';
import { CAPTURE_CONFIG, distanceMetres } from '../game/rules';

/**
 * Recurring-cat matching (README 9.3).
 *
 * The problem: decide whether a new photo is of a cat we already have a record for, so
 * repeat encounters build a relationship instead of spawning duplicate Dex entries.
 *
 * The approach: location plus appearance. Neither alone works — two tabbies on the same
 * street are different cats, and the same cat photographed two streets over is still that
 * cat, but it is far more often the first case. So we scope candidates to a radius and
 * then compare coat labels.
 *
 * `identityKey` is a coarse pre-filter, not the decision. It buckets by a rounded
 * location cell and a sorted coat signature, giving a cheap indexed lookup; the real
 * match is `scoreCandidate` below, which uses true distance and label overlap. Doing it
 * in two stages keeps the query indexed while letting the comparison be fuzzy.
 *
 * Known limitation: without visual embeddings this cannot distinguish two identical
 * tabbies on the same block, and it will split one cat into two records if it moves
 * between distant haunts. Phase 2's custom classifier is where embeddings come in; the
 * `matchCat` signature is the seam that swap happens behind.
 */

/** Rounding applied to coordinates when bucketing. ~110m per 0.001 degree of latitude. */
const CELL_PRECISION = 3;

export function identityKey(params: {
  lat: number;
  lng: number;
  coatLabels: string[];
}): string {
  const cell = `${params.lat.toFixed(CELL_PRECISION)},${params.lng.toFixed(CELL_PRECISION)}`;
  const coat = [...params.coatLabels].sort().join('|') || 'unknown';

  return createHash('sha1').update(`${cell}::${coat}`).digest('hex').slice(0, 32);
}

export interface MatchInput {
  lat: number;
  lng: number;
  coatLabels: string[];
}

export interface MatchResult {
  cat: Cat;
  /** 0-1. Above `MATCH_THRESHOLD` the photo is treated as the same animal. */
  score: number;
}

export const MATCH_THRESHOLD = 0.55;

/**
 * Finds the existing cat this photo is most likely of, or null for a new discovery.
 *
 * Candidates come from a bounding box rather than a radius query — Postgres can serve a
 * box from the plain (lat, lng) index, where a true radius would need PostGIS for one
 * lookup. The box is a superset, and `scoreCandidate` applies the real distance test.
 */
export async function matchCat(input: MatchInput): Promise<MatchResult | null> {
  const radiusM = CAPTURE_CONFIG.identityRadiusM;

  // Degrees of latitude are constant; degrees of longitude shrink toward the poles, so
  // the longitude span has to be divided by cos(latitude) or the box is too narrow at
  // high latitudes and cats there stop matching.
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(0.01, Math.cos((input.lat * Math.PI) / 180)));

  const candidates = await prisma.cat.findMany({
    where: {
      firstSeenLat: { gte: input.lat - latDelta, lte: input.lat + latDelta },
      firstSeenLng: { gte: input.lng - lngDelta, lte: input.lng + lngDelta },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 25,
  });

  let best: MatchResult | null = null;

  for (const cat of candidates) {
    const score = scoreCandidate(input, cat);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { cat, score };
    }
  }

  return best;
}

/**
 * Similarity between a new sighting and a known cat, as a 0-1 blend of proximity and
 * coat agreement.
 *
 * Coat is weighted higher than distance because distance inside the radius is weak
 * evidence — every cat on the street is inside it — while a calico matching a calico is
 * strong. When neither side has coat labels the comparison degrades to a neutral 0.5
 * rather than a false match, which biases toward creating a new record; splitting one cat
 * into two Dex entries is a recoverable annoyance, merging two cats into one is not.
 */
export function scoreCandidate(input: MatchInput, cat: Cat): number {
  const metres = distanceMetres(
    { lat: input.lat, lng: input.lng },
    { lat: cat.firstSeenLat, lng: cat.firstSeenLng }
  );

  if (metres > CAPTURE_CONFIG.identityRadiusM) return 0;

  const proximity = 1 - metres / CAPTURE_CONFIG.identityRadiusM;
  const coat = coatSimilarity(input.coatLabels, cat.coatLabels);

  return proximity * 0.35 + coat * 0.65;
}

/** Jaccard overlap of the two coat-label sets. */
export function coatSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0.5;

  const left = new Set(a);
  const right = new Set(b);

  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;

  const union = left.size + right.size - intersection;

  return union === 0 ? 0.5 : intersection / union;
}
