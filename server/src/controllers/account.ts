import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as accountService from '../services/account.js';

/** Account settings, and the one auth action the app cannot perform itself. */

export const pushTokenSchema = z.strictObject({
  token: z.string().min(1).max(255),
});

export async function setPushToken(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof pushTokenSchema>;
    await accountService.setPushToken(req.user!.id, body.token);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export const homeLocationSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function setHomeLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof homeLocationSchema>;
    await accountService.setHomeLocation(req.user!.id, body);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function preferences(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await accountService.getPreferences(req.user!.id));
  } catch (err) {
    next(err);
  }
}

/**
 * Every field optional, and an absent one leaves the preference alone.
 *
 * `strictObject`, so a misspelled key is refused rather than silently doing nothing — a
 * settings toggle that reports success and changes nothing is the worst version of this.
 */
export const preferencesSchema = z.strictObject({
  shareCapturesByDefault: z.boolean().optional(),
  pushChallengeResults: z.boolean().optional(),
  pushVotes: z.boolean().optional(),
  pushNearbyRareCats: z.boolean().optional(),
});

export async function setPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof preferencesSchema>;
    res.json(await accountService.setPreferences(req.user!.id, body));
  } catch (err) {
    next(err);
  }
}

export async function deleteAccount(req: Request, res: Response, next: NextFunction) {
  try {
    await accountService.deleteAccount(req.user!.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
