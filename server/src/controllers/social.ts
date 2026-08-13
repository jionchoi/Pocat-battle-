import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import * as socialService from '../services/social.js';
import * as friendService from '../services/friends.js';
import { parseOrThrow } from '../middleware/validate.js';

/** Leaderboards, search, public profiles and friendships. */

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const leaderboardQuerySchema = z.object({
  scope: z.preprocess(
    blankToUndefined,
    z.enum(['neighborhood', 'city', 'global', 'friends']).default('global')
  ),
  metric: z.preprocess(
    blankToUndefined,
    z.enum(['community', 'votesReceived', 'challengeWins', 'topPhoto']).default('community')
  ),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
});

export async function leaderboard(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parseOrThrow(leaderboardQuerySchema, req.query);
    res.json(await socialService.leaderboard(req.user!.id, query));
  } catch (err) {
    next(err);
  }
}

export const searchQuerySchema = z.object({
  q: z.preprocess(blankToUndefined, z.string().max(60).default('')),
});

export async function search(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parseOrThrow(searchQuerySchema, req.query);
    res.json(await socialService.searchUsers(req.user!.id, query.q));
  } catch (err) {
    next(err);
  }
}

export async function publicProfile(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await socialService.publicProfile(req.user!.id, req.params['userId'] as string)
    );
  } catch (err) {
    next(err);
  }
}

/* --------------------------------- friends -------------------------------- */

export async function friends(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await friendService.listFriends(req.user!.id));
  } catch (err) {
    next(err);
  }
}

/** By username, because that is what a player can type and what search shows. */
export const addFriendSchema = z.strictObject({
  username: z.string().trim().min(1).max(30),
});

export async function addFriend(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof addFriendSchema>;
    res.json(await friendService.requestFriend(req.user!.id, body.username));
  } catch (err) {
    next(err);
  }
}

export const respondSchema = z.strictObject({
  friendshipId: z.uuid(),
  accept: z.boolean(),
});

export async function respond(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof respondSchema>;

    res.json(
      await friendService.respondToRequest(req.user!.id, body.friendshipId, body.accept)
    );
  } catch (err) {
    next(err);
  }
}

/** 204: the client's `unfriend` is typed void and its helper short-circuits on 204. */
export async function unfriend(req: Request, res: Response, next: NextFunction) {
  try {
    await friendService.unfriend(req.user!.id, req.params['userId'] as string);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
