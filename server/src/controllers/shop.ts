import type { Request, Response, NextFunction } from 'express';

import * as shopService from '../services/shop.js';

/** Thin, like the rest: call and respond. There is no body to validate on a read. */

export async function catalog(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await shopService.catalog(req.user!.id));
  } catch (err) {
    next(err);
  }
}
