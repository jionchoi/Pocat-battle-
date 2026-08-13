import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as feedService from '../services/feed.js';
import { parseOrThrow } from '../middleware/validate.js';

/**
 * The feed.
 *
 * Two endpoints with two different readers: `/feed` always has one, `/feed/viral` may have
 * none at all. The second is why `optionalAuth` exists.
 */

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const feedQuerySchema = z.object({
  scope: z.preprocess(blankToUndefined, z.enum(['everyone', 'friends']).default('everyone')),
  cursor: z.preprocess(blankToUndefined, z.string().max(200).optional()),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parseOrThrow(feedQuerySchema, req.query);
    res.json(await feedService.listFeed(req.user!.id, query));
  } catch (err) {
    next(err);
  }
}

/**
 * `window` is a *request*, not a promise. The service widens it when the window is too thin
 * to be worth showing, and the response says which one it actually ranked over.
 */
export const viralQuerySchema = z.object({
  window: z.preprocess(blankToUndefined, z.enum(['today', 'week', 'all']).default('today')),
  /** A rank is a position in a computed ordering, so paging here is an offset, not a cursor. */
  offset: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional()),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
});

export async function viral(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parseOrThrow(viralQuerySchema, req.query);

    /*
     * `req.user` is optional here and that is the whole design. The ranked page is identical
     * for every reader, so leaving the Authorization header off is what lets a CDN serve it
     * from the edge — a request carrying a bearer token is uncacheable by definition. The
     * cost is `myReaction: null` on every card, which the client overlays from its own store.
     */
    res.json(await feedService.viralFeed(req.user?.id ?? null, query));
  } catch (err) {
    next(err);
  }
}
