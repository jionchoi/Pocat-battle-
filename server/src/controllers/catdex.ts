import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as catDexService from '../services/catDex.js';

/**
 * The Cat Dex.
 *
 * Thin, like the other two: validate, call, respond. The only thing worth reading here is the
 * patch schema, which is a restatement of `catdexApi.update` in the client's endpoints.ts.
 */

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await catDexService.listDex(_req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function profile(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await catDexService.dexProfile(req.user!.id, req.params['catId'] as string));
  } catch (err) {
    next(err);
  }
}

/**
 * The fields a player owns on their entry.
 *
 * `strictObject` rather than `object`, for the reason `identifySchema` learned the hard way:
 * a plain `z.object` strips unknown keys, so a body carrying a field this endpoint does not
 * grant would be accepted silently rather than refused. The bounds match
 * `cat_dex_entries_nickname_length` and `cat_dex_entries_bio_length` on the columns, so an
 * over-long name is refused here in words a player can read rather than arriving at Postgres
 * as a constraint violation.
 *
 * `bestPhotoPinned` is `false` and only `false`. Pinning is done by naming a photo — there is
 * no photograph to pin implied by `true`, and accepting it would be accepting a request that
 * cannot be carried out.
 */
export const updateCatSchema = z
  .strictObject({
    nickname: z.string().trim().min(1).max(30).optional(),

    /*
     * Empty string clears it; absent leaves it alone.
     *
     * A PATCH carries what changed, so an absent `bio` must not wipe one somebody wrote. But
     * a player who selects their bio and deletes it has changed it to nothing, and the only
     * way that intent reaches here is as `""`. It becomes null so the column holds one
     * representation of "no bio" rather than two.
     */
    bio: z
      .string()
      .max(200)
      .optional()
      .transform((value) => (value !== undefined && value.trim() === '' ? null : value)),

    bestPhotoId: z.uuid().optional(),
    bestPhotoPinned: z.literal(false).optional(),
  })
  .refine(
    (body) => !(body.bestPhotoId !== undefined && body.bestPhotoPinned === false),
    {
      /*
       * Pinning a photo and releasing the pin in one request is not a preference to resolve —
       * whichever order they were applied in, the caller asked for the opposite of it too.
       */
      message: 'Pin a photo or release the pin, not both in one request.',
      path: ['bestPhotoPinned'],
    }
  );

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof updateCatSchema>;

    res.json(
      await catDexService.updateDexEntry(req.user!.id, req.params['catId'] as string, body)
    );
  } catch (err) {
    next(err);
  }
}
