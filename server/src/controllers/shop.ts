import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as shopService from '../services/shop.js';

/** Thin, like the rest: call and respond. There is no body to validate on a read. */

export async function catalog(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await shopService.catalog(req.user!.id));
  } catch (err) {
    next(err);
  }
}

/**
 * Buying one catalogue item with paws.
 *
 * The id and nothing else. **No price and no quantity** — the authored row is the only price
 * the server will charge, and a request that could name an amount would be a request to
 * negotiate. `strictObject` so an extra key is a 400 rather than something quietly ignored;
 * trap 16 is what that habit came from.
 *
 * Bounded because it reaches a `.find` over the catalogue and ends up in a text column. The
 * ids are authored and short; anything near this length is not a typo.
 */
export const unlockSchema = z.strictObject({
  entryId: z.string().min(1).max(64),
});

export async function unlock(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { entryId: string };
    res.json(await shopService.unlock(req.user!.id, body.entryId));
  } catch (err) {
    next(err);
  }
}
