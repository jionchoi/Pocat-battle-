import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as albumService from '../services/album.js';
import { parseOrThrow } from '../middleware/validate.js';

/**
 * The album.
 *
 * Thin, like the photos controller: read the query, call the service, respond. The filters
 * are the only thing worth reading here, and they are a restatement of `AlbumQuery` in the
 * client's `src/api/endpoints.ts` — which is the contract, so this schema is what enforces it.
 */

/**
 * Everything arrives as a string, or not at all.
 *
 * A query string has no types and no null: an unset filter is an absent key, and a filter
 * the player cleared is also an absent key, because the client drops undefined values before
 * building the URL. An empty string is therefore not a search for nothing — it is a client
 * that sent `?search=` by accident, and it is treated as no filter at all.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const albumQuerySchema = z.object({
  tier: z.preprocess(blankToUndefined, z.enum(['Common', 'Rare', 'Epic', 'Legendary']).optional()),

  /** Matched against what the player calls the cat, never the caption. See catNames.ts. */
  search: z.preprocess(blankToUndefined, z.string().max(60).optional()),

  catId: z.preprocess(blankToUndefined, z.uuid().optional()),

  /** Newest first unless asked otherwise, which is how the grid opens. */
  sort: z.preprocess(blankToUndefined, z.enum(['recent', 'score']).default('recent')),

  /** Opaque. Its shape depends on the sort, and only the service knows that. */
  cursor: z.preprocess(blankToUndefined, z.string().max(200).optional()),

  /*
   * Coerced, because `?limit=30` is the string "30". Only the floor is checked here — the
   * service clamps the ceiling rather than refusing, since a caller asking for too many
   * rows wants rows, and a 400 teaches it nothing it can act on.
   */
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parseOrThrow(albumQuerySchema, req.query);

    res.json(
      await albumService.listAlbum({
        userId: req.user!.id,
        ...query,
      })
    );
  } catch (err) {
    next(err);
  }
}
