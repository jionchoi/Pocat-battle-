import type { Request, Response, NextFunction } from 'express';

import * as mapService from '../services/map.js';
import { parseBbox } from '../game/map.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * The map.
 *
 * The bounding box is parsed by `game/map.ts` rather than by a zod schema, because it is one
 * string carrying four numbers with rules about their relationship — which zod can express and
 * cannot express *readably*, and which needs to be runnable without env for the checks.
 */
export async function sightings(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.query['bbox'];

    if (typeof raw !== 'string' || raw.length === 0) {
      throw new HttpError(400, 'That map area could not be read.');
    }

    const parsed = parseBbox(raw);

    /*
     * The parser's own message, verbatim.
     *
     * It distinguishes "unreadable" from "too big to answer", and the second one is
     * actionable — "zoom in a little" tells a player what to do, where a generic 400 leaves
     * them looking at an empty map wondering whether there are no cats or no service.
     */
    if ('error' in parsed) throw new HttpError(400, parsed.error);

    res.json(await mapService.sightingsIn(req.user!.id, parsed));
  } catch (err) {
    next(err);
  }
}
