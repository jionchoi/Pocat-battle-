import type { Request, Response } from 'express';
import { z } from 'zod';

import { authOf } from '../middleware/auth';
import { serializePhotoWithAuthor } from '../serializers/photo';
import { dexEntriesFor } from '../services/albumService';
import { listFeed, react } from '../services/feedService';
import { CACHE, getViralPage, recordImpressions } from '../services/viralService';

/**
 * Community feed and reactions (README sections 5.4 and 9.5).
 */

export const feedQuerySchema = z.object({
  scope: z.enum(['everyone', 'friends']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

export const viralQuerySchema = z.object({
  window: z.enum(['today', 'week', 'all']).optional(),
  offset: z.coerce.number().int().min(0).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

export const voteSchema = z.object({
  reaction: z.enum(['laugh', 'love', 'wow']),
});

export const impressionsSchema = z.object({
  // Bounded so a client cannot claim to have viewed an unbounded set in one call.
  photoIds: z.array(z.string().min(1)).min(1).max(100),
});

export async function feed(req: Request, res: Response) {
  const { userId } = authOf(req);
  const query = req.query as z.infer<typeof feedQuerySchema>;

  const { photos, nextCursor } = await listFeed({
    viewerId: userId,
    friendsOnly: query.scope === 'friends',
    cursor: query.cursor,
    limit: query.limit ?? 20,
  });

  // The viewer's own nicknames only apply to cats they have photographed themselves;
  // for everyone else's photos this falls back to the discoverer's default name.
  const dexEntries = await dexEntriesFor(userId, photos.map((p) => p.catId));

  res.json({
    photos: photos.map((photo) =>
      serializePhotoWithAuthor(photo, {
        viewerId: userId,
        dexEntry: dexEntries.get(photo.catId),
        cat: photo.cat,
      })
    ),
    nextCursor,
  });
}

/**
 * The viral home feed.
 *
 * One request serves both halves of the screen: `trending` is the top of the ranking and
 * `rising` is everything under it. They are split server-side because "the rail is the top
 * five" is a property of the ranking, and a client slicing the array itself would silently
 * disagree the moment the rail size changes. The rail is first-page-only — scrolling the
 * wall must not keep re-serving the same five photos at every page boundary.
 *
 * ## Unauthenticated, and that is the point
 *
 * This endpoint carries no per-viewer data. Every field in the response is the same for
 * every reader, which is what allows three things at once: one cached copy in Redis serves
 * every instance, a CDN can hold it at the edge, and neither has to be keyed by user. At
 * 100k concurrent that is the difference between 100k origin requests per refresh and one.
 *
 * The content is already public by construction — a photo only appears here if its owner
 * opted into sharing it. The one field that *was* per-viewer, `myReaction`, is resolved by
 * the client from its own state; it is the reader's own action, so the reader already
 * knows it. `catNickname` likewise now shows the discoverer's name rather than the
 * viewer's private nickname for that cat, which also drops a per-request database query.
 */
export async function viral(req: Request, res: Response) {
  const query = req.query as z.infer<typeof viralQuerySchema>;

  const offset = query.offset ?? 0;
  const limit = query.limit ?? 24;
  const window = query.window ?? 'today';

  const body = await getViralPage(window, offset, limit);

  // `stale-while-revalidate` lets the edge keep serving during a refresh instead of
  // stampeding the origin the instant the entry expires — the same pattern the Redis
  // layer uses one tier down, for the same reason.
  res.setHeader(
    'Cache-Control',
    `public, max-age=${CACHE.freshSeconds}, stale-while-revalidate=${CACHE.staleSeconds}`
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Already a JSON string from the cache. Re-parsing it here only to have Express
  // serialize it again would be pure waste on the most-served endpoint in the product.
  res.send(body);
}

/**
 * Records that the signed-in player actually saw these photos.
 *
 * Fire-and-forget from the client's point of view — the response carries nothing it needs,
 * and it is answered before the write is durable anywhere. This is the highest-frequency
 * request in the product, so it does one pipelined Redis round trip and nothing else.
 */
export async function impressions(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof impressionsSchema>;

  const result = await recordImpressions({ viewerId: userId, photoIds: body.photoIds });

  res.json(result);
}

export async function vote(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof voteSchema>;

  const result = await react({
    photoId: req.params.id,
    voterId: userId,
    reaction: body.reaction,
  });

  res.json(result);
}
