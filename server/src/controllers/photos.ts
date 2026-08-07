import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as photoService from '../services/photos.js';

/**
 * Photos.
 *
 * Thin on purpose: validate what arrived, call the service, shape the reply. Every decision
 * about allowances, scoring and storage lives in the service, so this file stays readable
 * as a list of what the API accepts.
 */

export const captureSchema = z.object({
  /** `<user_id>/<uuid>.jpg`. The phone has already put the bytes there. */
  storagePath: z.string().min(1).max(200),

  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),

  /*
   * The phone's clock, and treated as a hint. It is used for ordering an album, never for
   * the allowance window — that is measured server-side precisely so it cannot be moved.
   */
  capturedAt: z.iso.datetime().optional(),
});

export async function capture(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof captureSchema>;

    const result = await photoService.capture({
      userId: req.user!.id,
      storagePath: body.storagePath,
      lat: body.location.lat,
      lng: body.location.lng,
      capturedAt: body.capturedAt,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function reveal(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await photoService.reveal(req.user!.id, req.params['photoId'] as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function allowance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await photoService.revealAllowance(req.user!.id));
  } catch (err) {
    next(err);
  }
}
