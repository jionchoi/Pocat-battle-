import type { Request, Response, NextFunction } from 'express';

import * as pawService from '../services/paws.js';

/**
 * Paws — the balance, and giving one away.
 *
 * Thin, like the rest: no body to validate on either, because there is nothing for the caller
 * to say. **How many** paws is fixed at one per tap, and **which bucket** they come out of is
 * the server's decision — see `chooseBucket` in `game/paws.ts` for why that is not a choice
 * the client gets to make. A request carrying an amount or a bucket would be a request to be
 * argued with.
 *
 * There is no reversal action here on purpose. A gift is final; `game/paws.ts` says why.
 */

/** `GET /paws/balance`. Settles the grant period as a side effect; that is the design. */
export async function balance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pawService.balance(req.user!.id));
  } catch (err) {
    next(err);
  }
}

/** `POST /photos/:photoId/paw`. */
export async function give(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pawService.give(req.user!.id, req.params['photoId'] as string));
  } catch (err) {
    next(err);
  }
}
