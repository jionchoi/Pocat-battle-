import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import { uuidParam, validate } from '../middleware/validate.js';
import { socialLimit } from '../middleware/rateLimit.js';
import * as socialController from '../controllers/social.js';

/**
 * Three routers' worth of paths that the client's contract puts at three different roots —
 * `/leaderboard`, `/users` and `/friends` — mounted separately in app.ts so each keeps the
 * path the app actually calls.
 */

export const leaderboardRouter = Router();
leaderboardRouter.get('/', authenticate, socialController.leaderboard);

export const usersRouter = Router();
/** Before `/:userId`, or "search" is matched as a user id. */
usersRouter.get('/search', authenticate, socialLimit, socialController.search);
usersRouter.get(
  '/:userId/public-profile',
  authenticate,
  uuidParam('userId'),
  socialController.publicProfile
);

export const friendsRouter = Router();
friendsRouter.get('/', authenticate, socialController.friends);
friendsRouter.post(
  '/',
  authenticate,
  socialLimit,
  validate(socialController.addFriendSchema),
  socialController.addFriend
);
/** Before `/:userId`, for the same reason as `/search`. */
friendsRouter.post(
  '/respond',
  authenticate,
  socialLimit,
  validate(socialController.respondSchema),
  socialController.respond
);
friendsRouter.delete(
  '/:userId',
  authenticate,
  socialLimit,
  uuidParam('userId'),
  socialController.unfriend
);
