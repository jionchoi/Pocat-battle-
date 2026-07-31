import type { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/client';
import { authOf } from '../middleware/auth';
import { registerPushToken } from '../integrations/push';
import { serializeMe } from '../serializers/photo';
import { albumUsage } from '../services/albumService';
import { coarsen } from '../services/mapService';
import { xpToNextRank } from '../services/progressionService';
import * as auth from '../services/authService';

export const signupSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(10, 'Passwords need at least 10 characters.'),
  username: z.string().min(3).max(20),
});

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const socialSchema = z.object({
  provider: z.enum(['google', 'apple']),
  idToken: z.string().min(10),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const usernameSchema = z.object({
  username: z.string().min(3).max(20),
  avatarUrl: z.string().url().optional(),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10),
});

export const homeLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function signup(req: Request, res: Response) {
  const result = await auth.signup(req.body);
  const me = await loadMe(result.userId);
  res.status(201).json({ ...result.tokens, user: me });
}

export async function login(req: Request, res: Response) {
  const result = await auth.login(req.body);
  const me = await loadMe(result.userId);
  res.json({ ...result.tokens, user: me });
}

export async function social(req: Request, res: Response) {
  const result = await auth.socialSignIn(req.body);
  const me = await loadMe(result.userId);
  res.json({ ...result.tokens, user: me, isNewAccount: result.isNewAccount });
}

export async function refresh(req: Request, res: Response) {
  const tokens = await auth.refresh(req.body.refreshToken);
  res.json(tokens);
}

export async function logout(req: Request, res: Response) {
  await auth.logout(req.body.refreshToken);
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  res.json({ user: await loadMe(authOf(req).userId) });
}

export async function setUsername(req: Request, res: Response) {
  const { userId } = authOf(req);
  await auth.setUsername({ userId, ...req.body });
  res.json({ user: await loadMe(userId) });
}

export async function setPushToken(req: Request, res: Response) {
  await registerPushToken({ userId: authOf(req).userId, token: req.body.token });
  res.status(204).send();
}

/**
 * Home location for the neighbourhood leaderboard.
 *
 * Coarsened to a ~1km cell before it is stored. We need enough precision to bucket a
 * leaderboard and no more — keeping a player's exact home coordinates is a liability we
 * can simply decline to take on.
 */
export async function setHomeLocation(req: Request, res: Response) {
  const { userId } = authOf(req);
  const coarse = coarsen(req.body.lat, req.body.lng);

  await prisma.user.update({
    where: { id: userId },
    data: { homeLat: coarse.lat, homeLng: coarse.lng },
  });

  res.status(204).send();
}

export const preferencesSchema = z.object({
  shareCapturesByDefault: z.boolean().optional(),
  pushChallengeResults: z.boolean().optional(),
  pushVotes: z.boolean().optional(),
  pushNearbyRareCats: z.boolean().optional(),
});

/** Settings screen toggles — sharing default and the three notification categories. */
export async function setPreferences(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof preferencesSchema>;

  const user = await prisma.user.update({
    where: { id: userId },
    data: body,
    select: {
      shareCapturesByDefault: true,
      pushChallengeResults: true,
      pushVotes: true,
      pushNearbyRareCats: true,
    },
  });

  res.json({ preferences: user });
}

export async function getPreferences(req: Request, res: Response) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: authOf(req).userId },
    select: {
      shareCapturesByDefault: true,
      pushChallengeResults: true,
      pushVotes: true,
      pushNearbyRareCats: true,
    },
  });

  res.json({ preferences: user });
}

export async function deleteAccount(req: Request, res: Response) {
  await auth.deleteAccount(authOf(req).userId);
  res.status(204).send();
}

async function loadMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const [friendships, quota, catsDiscovered] = await Promise.all([
    prisma.friendship.findMany({
      where: { accepted: true, OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    }),
    // Quota rules live in albumService so the cap is defined in exactly one place.
    albumUsage(userId, user.proSubscriptionActive),
    prisma.catDexEntry.count({ where: { userId } }),
  ]);

  return serializeMe(user, {
    friendIds: friendships.map((f) =>
      f.requesterId === userId ? f.addresseeId : f.requesterId
    ),
    photoCount: quota.photoCount,
    photoLimit: quota.photoLimit,
    catsDiscovered,
    xpToNextRank: xpToNextRank(user.photographerXp),
  });
}
