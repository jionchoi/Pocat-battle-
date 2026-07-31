import type { Request, Response } from 'express';
import { z } from 'zod';

import { authOf } from '../middleware/auth';
import { serializePhotoWithAuthor } from '../serializers/photo';
import { dexEntriesFor } from '../services/albumService';
import { listFeed, react, recordImpressions } from '../services/feedService';

/**
 * Community feed and reactions (README sections 5.4 and 9.5).
 */

export const feedQuerySchema = z.object({
  scope: z.enum(['everyone', 'friends']).optional(),
  cursor: z.string().optional(),
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
 * Records that the signed-in player actually saw these photos.
 *
 * Fire-and-forget from the client's point of view — the response carries nothing it
 * needs. Duplicates are dropped server-side by the unique constraint, so a client that
 * over-reports cannot inflate anyone's denominator.
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
