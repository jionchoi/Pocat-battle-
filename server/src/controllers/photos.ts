import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as photoService from '../services/photos.js';
import * as identityService from '../services/catIdentity.js';
import { candidatesFor } from '../services/catMatching.js';

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

  /**
   * What the phone's detector saw. `false` skips the scoring call entirely.
   *
   * Optional so an older build, which does not send it, keeps scoring rather than silently
   * stopping. See the note on `CaptureInput.detected` for why trusting this is safe.
   */
  detected: z.boolean().optional(),
});

export async function capture(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof captureSchema>;

    const result = await photoService.capture({
      userId: req.user!.id,
      storagePath: body.storagePath,
      detected: body.detected,
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

/** One photo of the caller's own. 404 for anything else, including somebody else's. */
export async function detail(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await photoService.detail(req.user!.id, req.params['photoId'] as string)
    );
  } catch (err) {
    next(err);
  }
}

/**
 * The four fields a player owns on their own photo.
 *
 * Every one optional — a PATCH carries what changed and nothing else, so the caption is not
 * cleared by a request that only meant to toggle sharing. 140 matches the check constraint
 * on the column, so an over-long caption is refused here with a readable message rather
 * than arriving at Postgres as a constraint violation.
 */
export const updatePhotoSchema = z.object({
  caption: z.string().max(140).optional(),
  sharedToFeed: z.boolean().optional(),
  showcased: z.boolean().optional(),
  /** Whether this capture becomes a pin for other players. See the service's note. */
  sharedToMap: z.boolean().optional(),
});

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof updatePhotoSchema>;

    res.json(
      await photoService.update(req.user!.id, req.params['photoId'] as string, body)
    );
  } catch (err) {
    next(err);
  }
}

/**
 * 204, with no body.
 *
 * The client's `photoApi.remove` is typed `void` and its request helper short-circuits on
 * 204 without parsing — so returning the deleted photo would be inventing a payload that
 * nothing reads and that the transport layer discards anyway.
 */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await photoService.remove(req.user!.id, req.params['photoId'] as string);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * Which cat a photograph is of.
 *
 * A union rather than two optional fields, so "pick this cat" and "none of these, here is a
 * new one" cannot arrive together. Zod refuses a body carrying both, which is a request whose
 * intent genuinely cannot be guessed.
 *
 * The nickname's bounds match `cat_dex_entries_nickname_length` on the column, so an
 * over-long name is refused here in words a player can read rather than arriving at Postgres
 * as a constraint violation.
 */
export const identifySchema = z.union([
  z.strictObject({ catId: z.uuid() }),
  z.strictObject({ newCat: z.strictObject({ nickname: z.string().trim().min(1).max(30) }) }),
]);

export async function identify(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof identifySchema>;

    res.json(
      await identityService.identify(req.user!.id, req.params['photoId'] as string, body)
    );
  } catch (err) {
    next(err);
  }
}

/**
 * The shortlist for one photo, for identifying it from the album later.
 *
 * Reads the photo through the same ownership check every other single-photo route uses, so a
 * photograph belonging to somebody else is a 404 here too. Without that this would answer
 * "which cats are near this id", which is a question about a stranger's location.
 */
export async function candidates(req: Request, res: Response, next: NextFunction) {
  try {
    const photo = await photoService.ownedPhoto(
      req.user!.id,
      req.params['photoId'] as string
    );

    res.json({ candidates: await candidatesFor(req.user!.id, photo) });
  } catch (err) {
    next(err);
  }
}

/**
 * Both quotas, on the endpoint the client already asks before it opens the camera.
 *
 * The album's capacity rides along with the reveal allowance rather than getting a route of
 * its own, because every caller wants them together: the capture screen has to know whether
 * the shutter leads to a score *and* whether the album has room, and the album screen draws
 * one meter from each. Two endpoints would mean two round trips that are always made in
 * pairs.
 */
export async function allowance(req: Request, res: Response, next: NextFunction) {
  try {
    const [reveals, album] = await Promise.all([
      photoService.revealAllowance(req.user!.id),
      photoService.albumUsage(req.user!.id),
    ]);

    res.json({ ...reveals, album });
  } catch (err) {
    next(err);
  }
}
