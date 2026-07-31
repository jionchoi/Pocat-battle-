import type { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/client';
import { authOf } from '../middleware/auth';
import { serializeCat, serializePhoto } from '../serializers/photo';
import { submitCapture } from '../services/captureService';
import { recordSighting } from '../services/mapService';

/**
 * Photo submission (README section 11: `POST /photos`).
 *
 * The request carries an image and a location and nothing that could influence a score.
 * `clientConfidence`, `framingHeldMs` and `autoCaptured` are accepted as telemetry for
 * tuning the framing window — they are recorded in the request log, never in the score.
 */

export const captureSchema = z.object({
  // ~5.5 chars of base64 per 4 bytes; this bounds the body well under the 5mb express
  // limit and matches the 3MB ceiling the storage layer enforces on the decoded bytes.
  photoBase64: z.string().min(100).max(4_400_000),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  clientConfidence: z.number().min(0).max(1),
  framingHeldMs: z.number().int().min(0).max(60_000),
  autoCaptured: z.boolean(),
  logSighting: z.boolean(),
  shareToFeed: z.boolean(),
});

export async function submit(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof captureSchema>;

  const result = await submitCapture({
    userId,
    photoBase64: body.photoBase64,
    lat: body.location.lat,
    lng: body.location.lng,
    clientConfidence: body.clientConfidence,
    framingHeldMs: body.framingHeldMs,
    autoCaptured: body.autoCaptured,
    logSighting: body.logSighting,
    shareToFeed: body.shareToFeed,
  });

  if (result.outcome === 'rejected') {
    // A rejection is a normal outcome of the game loop, not a client error — the app
    // shows it as a result screen with guidance, so it gets a 200.
    res.json({
      outcome: 'rejected',
      reason: result.reason,
      message: result.message,
    });
    return;
  }

  const [photo, cat, entry] = await Promise.all([
    prisma.photo.findUniqueOrThrow({
      where: { id: result.photoId },
      include: { cat: true, votes: { where: { voterId: userId } } },
    }),
    prisma.cat.findUniqueOrThrow({ where: { id: result.catId } }),
    prisma.catDexEntry.findUniqueOrThrow({
      where: { userId_catId: { userId, catId: result.catId } },
    }),
  ]);

  const photoCount = await prisma.photo.count({
    where: { ownerId: userId, catId: result.catId },
  });

  res.json({
    outcome: 'scored',
    photo: serializePhoto(photo, { viewerId: userId, dexEntry: entry, cat }),
    cat: serializeCat(cat, entry, userId, {
      bestPhotoUrl: photo.imageUrl,
      photoCount,
    }),
    isNewCat: result.isNewCat,
    captionSuggestions: result.captionSuggestions,
    xpAwarded: result.xpAwarded,
    rankUp: result.rankUp,
  });
}

/**
 * Standalone sighting report — logging a pin without submitting a photo for scoring
 * (README 9.6: "any capture attempt, successful or not, can optionally log a pin").
 */
export const sightingSchema = z.object({
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
});

export async function reportSighting(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof sightingSchema>;

  const result = await recordSighting({
    userId,
    lat: body.location.lat,
    lng: body.location.lng,
    photoUrl: '',
  });

  res.status(201).json(result);
}
