import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as challengeService from '../services/challenges.js';

/**
 * Challenges. Thin, like the rest — the interesting decisions are all in the service, and
 * the most interesting one is that none of them run on a schedule.
 */

export async function active(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await challengeService.activeChallenges(req.user!.id));
  } catch (err) {
    next(err);
  }
}

/**
 * The signed-in player's own trophy case.
 *
 * A stranger's comes down inside their public profile, because a profile is one request; your
 * own does not, because your own profile is assembled on the device from stores that were
 * already loaded and has no `publicProfile` call to hang it off.
 */
export async function wins(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ trophies: await challengeService.challengeWins(req.user!.id) });
  } catch (err) {
    next(err);
  }
}

export async function eligiblePhotos(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await challengeService.eligiblePhotos(req.user!.id));
  } catch (err) {
    next(err);
  }
}

export const submitSchema = z.strictObject({ photoId: z.uuid() });

export async function submit(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof submitSchema>;

    res.json(
      await challengeService.submitEntry(
        req.user!.id,
        req.params['challengeId'] as string,
        body.photoId
      )
    );
  } catch (err) {
    next(err);
  }
}

export async function entries(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await challengeService.challengeEntries(
        req.user!.id,
        req.params['challengeId'] as string
      )
    );
  } catch (err) {
    next(err);
  }
}
