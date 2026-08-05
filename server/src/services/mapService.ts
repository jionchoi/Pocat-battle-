import { prisma } from '../db/client';
import { errors } from '../errors';
import { MAP_CONFIG } from '../game/rules';

/**
 * Map and sighting logic (README section 9.6).
 *
 * Queries are always bounding-box scoped and hard-capped, so no client can ask for a
 * whole city by sending a huge viewport.
 */

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function parseBbox(raw: unknown): BoundingBox {
  if (typeof raw !== 'string') {
    throw errors.badRequest('A bbox query parameter is required.');
  }

  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw errors.badRequest('bbox must be minLng,minLat,maxLng,maxLat.');
  }

  const [minLng, minLat, maxLng, maxLat] = parts;

  if (minLat > maxLat || minLng > maxLng) {
    throw errors.badRequest('bbox bounds are inverted.');
  }
  if (
    maxLat - minLat > MAP_CONFIG.maxBboxDegrees ||
    maxLng - minLng > MAP_CONFIG.maxBboxDegrees
  ) {
    // Without this a client could request the whole planet and force a full table scan.
    throw errors.badRequest('That map area is too large. Zoom in and try again.');
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Sightings inside a viewport.
 *
 * Raw SQL for the same reason the user search is: to hit an index that Prisma's query
 * builder cannot express.
 *
 * Two independent range predicates (`lat BETWEEN ... AND lng BETWEEN ...`) against two
 * single-column B-trees force Postgres to choose one of them, walk every row in that
 * latitude band, and re-check the longitude by hand. In a dense city that band is most of
 * the table, and the map fires this on every pan.
 *
 * `point(lng, lat) <@ box(...)` is a single two-dimensional containment lookup against the
 * GiST index, which is what a viewport query actually is.
 */
export async function sightingsInBox(box: BoundingBox) {
  return prisma.$queryRaw<
    {
      id: string;
      reportedByUserId: string;
      lat: number;
      lng: number;
      photoUrl: string;
      verified: boolean;
      createdAt: Date;
    }[]
  >`
    SELECT "id", "reportedByUserId", "lat", "lng", "photoUrl", "verified", "createdAt"
    FROM "CatSighting"
    WHERE point("lng", "lat") <@ box(
            point(${box.minLng}, ${box.minLat}),
            point(${box.maxLng}, ${box.maxLat})
          )
      AND "expiresAt" > NOW()
    ORDER BY "createdAt" DESC
    LIMIT ${MAP_CONFIG.maxViewportResults}
  `;
}

/**
 * Record a sighting and corroborate any nearby recent one.
 *
 * Verification requires a second *independent* report — the same player reporting twice
 * cannot self-verify, which is the whole point of the badge.
 */
export async function recordSighting(params: {
  userId: string;
  lat: number;
  lng: number;
  photoUrl: string;
}): Promise<{ id: string; verified: boolean }> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + MAP_CONFIG.sightingTtlHours * 3600 * 1000
  );

  // Degrees-per-metre varies with latitude; approximating with the equatorial value
  // over-selects slightly, and the exact haversine filter below trims the excess.
  const degreeDelta = MAP_CONFIG.corroborationRadiusM / 111_320;
  const windowStart = new Date(
    now.getTime() - MAP_CONFIG.corroborationWindowHours * 3600 * 1000
  );

  const nearby = await prisma.catSighting.findMany({
    where: {
      lat: { gte: params.lat - degreeDelta, lte: params.lat + degreeDelta },
      lng: { gte: params.lng - degreeDelta, lte: params.lng + degreeDelta },
      createdAt: { gte: windowStart },
      reportedByUserId: { not: params.userId },
    },
    take: 20,
  });

  const corroborating = nearby.filter(
    (s) =>
      haversine({ lat: s.lat, lng: s.lng }, { lat: params.lat, lng: params.lng }) <=
      MAP_CONFIG.corroborationRadiusM
  );

  const created = await prisma.$transaction(async (tx) => {
    const sighting = await tx.catSighting.create({
      data: {
        reportedByUserId: params.userId,
        lat: params.lat,
        lng: params.lng,
        photoUrl: params.photoUrl,
        expiresAt,
        corroborationCount: corroborating.length,
        verified: corroborating.length > 0,
      },
    });

    // The new report corroborates the older ones too, so their badges flip as well.
    if (corroborating.length > 0) {
      await tx.catSighting.updateMany({
        where: { id: { in: corroborating.map((s) => s.id) } },
        data: { corroborationCount: { increment: 1 }, verified: true },
      });
    }

    return sighting;
  });

  return { id: created.id, verified: created.verified };
}

export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Round a coordinate to a coarse cell before storing it as a player's home location.
 * We need enough precision to bucket a neighbourhood leaderboard and no more — storing a
 * player's exact home coordinates is a liability we can simply decline to take on.
 */
export function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  const cell = 0.01; // roughly 1.1km
  return {
    lat: Math.round(lat / cell) * cell,
    lng: Math.round(lng / cell) * cell,
  };
}

export function neighborhoodBucket(lat: number, lng: number): string {
  const c = coarsen(lat, lng);
  return `${c.lat.toFixed(2)}:${c.lng.toFixed(2)}`;
}
