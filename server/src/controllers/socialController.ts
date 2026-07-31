import type { Request, Response } from 'express';
import { z } from 'zod';

import { authOf } from '../middleware/auth';
import { serializePhoto, serializeUser } from '../serializers/photo';
import { dexEntriesFor } from '../services/albumService';
import {
  parseMetric,
  parseScope,
  publicProfile,
  readLeaderboard,
} from '../services/leaderboardService';
import {
  friendList,
  removeFriend,
  requestFriend,
  respondToRequest,
  searchUsers,
} from '../services/socialService';

export const leaderboardQuerySchema = z.object({
  scope: z.enum(['neighborhood', 'city', 'global', 'friends']).optional(),
  metric: z.enum(['topPhoto', 'totalScore', 'challengeWins']).optional(),
  limit: z.coerce.number().int().min(5).max(100).optional(),
});

export const friendRequestSchema = z.object({
  username: z.string().min(3).max(20),
});

export const friendRespondSchema = z.object({
  friendshipId: z.string().min(1),
  accept: z.boolean(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(2).max(40),
});

export async function leaderboard(req: Request, res: Response) {
  const { userId } = authOf(req);
  const query = req.query as z.infer<typeof leaderboardQuerySchema>;

  const result = await readLeaderboard({
    userId,
    scope: parseScope(query.scope),
    metric: parseMetric(query.metric),
    limit: query.limit,
  });

  res.json({
    ...result,
    computedAt: result.computedAt?.toISOString() ?? null,
  });
}

export async function profile(req: Request, res: Response) {
  const { userId } = authOf(req);
  const result = await publicProfile(req.params.id, userId);

  const dexEntries = await dexEntriesFor(
    userId,
    result.showcasePhotos.map((p) => p.catId)
  );

  res.json({
    user: serializeUser(result.user),
    showcasePhotos: result.showcasePhotos.map((photo) =>
      serializePhoto(photo, {
        viewerId: userId,
        dexEntry: dexEntries.get(photo.catId),
        cat: photo.cat,
      })
    ),
    totalPhotos: result.totalPhotos,
    catsDiscovered: result.catsDiscovered,
    bestScore: result.bestScore,
    challengeWins: result.challengeWins,
  });
}

export async function friends(req: Request, res: Response) {
  res.json(await friendList(authOf(req).userId));
}

export async function search(req: Request, res: Response) {
  const { userId } = authOf(req);
  const query = req.query as z.infer<typeof searchQuerySchema>;

  res.json({ users: await searchUsers({ query: query.q, excludeUserId: userId }) });
}

export async function addFriend(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof friendRequestSchema>;

  res.json(
    await requestFriend({ requesterId: userId, addresseeUsername: body.username })
  );
}

export async function respond(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof friendRespondSchema>;

  res.json(
    await respondToRequest({
      userId,
      friendshipId: body.friendshipId,
      accept: body.accept,
    })
  );
}

export async function unfriend(req: Request, res: Response) {
  await removeFriend({
    userId: authOf(req).userId,
    otherUserId: req.params.id,
  });
  res.status(204).send();
}
