import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

import * as albumCtl from '../controllers/albumController';
import * as authCtl from '../controllers/authController';
import * as captureCtl from '../controllers/captureController';
import * as challengeCtl from '../controllers/challengeController';
import * as feedCtl from '../controllers/feedController';
import * as mapCtl from '../controllers/mapController';
import * as shopCtl from '../controllers/shopController';
import * as socialCtl from '../controllers/socialController';
import { requireAuth } from '../middleware/auth';
import {
  authLimiter,
  captureLimiter,
  generalLimiter,
  mapLimiter,
} from '../middleware/rateLimit';
import { validate } from '../middleware/validate';

/**
 * The full API surface from README section 11, plus the endpoints that section implied
 * but did not list (account deletion, push token registration, notification preferences,
 * friend management, challenge entries, eligible-photo lookup).
 *
 * `asyncRoute` exists because Express 4 does not forward a rejected promise to the error
 * handler — without it, one thrown ApiError in an async controller hangs the request.
 */
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'catsnap', time: new Date().toISOString() });
});

/* ---------------------------------- auth ---------------------------------- */

router.post(
  '/auth/signup',
  authLimiter,
  validate(authCtl.signupSchema),
  asyncRoute(authCtl.signup)
);
router.post(
  '/auth/login',
  authLimiter,
  validate(authCtl.loginSchema),
  asyncRoute(authCtl.login)
);
router.post(
  '/auth/social',
  authLimiter,
  validate(authCtl.socialSchema),
  asyncRoute(authCtl.social)
);
router.post(
  '/auth/refresh',
  authLimiter,
  validate(authCtl.refreshSchema),
  asyncRoute(authCtl.refresh)
);
router.post('/auth/logout', validate(authCtl.refreshSchema), asyncRoute(authCtl.logout));

router.get('/auth/me', requireAuth, asyncRoute(authCtl.me));
router.patch(
  '/auth/username',
  requireAuth,
  validate(authCtl.usernameSchema),
  asyncRoute(authCtl.setUsername)
);
router.put(
  '/auth/push-token',
  requireAuth,
  validate(authCtl.pushTokenSchema),
  asyncRoute(authCtl.setPushToken)
);
router.put(
  '/auth/home-location',
  requireAuth,
  validate(authCtl.homeLocationSchema),
  asyncRoute(authCtl.setHomeLocation)
);
router.get('/auth/preferences', requireAuth, asyncRoute(authCtl.getPreferences));
router.patch(
  '/auth/preferences',
  requireAuth,
  validate(authCtl.preferencesSchema),
  asyncRoute(authCtl.setPreferences)
);
router.delete('/auth/account', requireAuth, asyncRoute(authCtl.deleteAccount));

/* --------------------------------- photos --------------------------------- */

router.post(
  '/photos',
  requireAuth,
  captureLimiter,
  validate(captureCtl.captureSchema),
  asyncRoute(captureCtl.submit)
);
router.get('/photos/:id', requireAuth, asyncRoute(albumCtl.photoDetail));
router.patch(
  '/photos/:id',
  requireAuth,
  validate(albumCtl.patchPhotoSchema),
  asyncRoute(albumCtl.patchPhoto)
);
router.delete('/photos/:id', requireAuth, asyncRoute(albumCtl.removePhoto));
router.post(
  '/photos/:id/vote',
  requireAuth,
  generalLimiter,
  validate(feedCtl.voteSchema),
  asyncRoute(feedCtl.vote)
);

/* ---------------------------------- album --------------------------------- */

router.get(
  '/album',
  requireAuth,
  generalLimiter,
  validate(albumCtl.albumQuerySchema, 'query'),
  asyncRoute(albumCtl.album)
);

/* --------------------------------- catdex --------------------------------- */

router.get('/catdex', requireAuth, generalLimiter, asyncRoute(albumCtl.catdex));
router.get('/catdex/:catId', requireAuth, asyncRoute(albumCtl.catProfile));
router.patch(
  '/catdex/:catId',
  requireAuth,
  validate(albumCtl.patchCatSchema),
  asyncRoute(albumCtl.patchCat)
);

/* ----------------------------------- map ---------------------------------- */

router.get('/map/sightings', requireAuth, mapLimiter, asyncRoute(mapCtl.sightings));
router.post(
  '/map/sightings',
  requireAuth,
  mapLimiter,
  validate(captureCtl.sightingSchema),
  asyncRoute(captureCtl.reportSighting)
);

/* ------------------------------- challenges ------------------------------- */

router.get('/challenges/active', requireAuth, asyncRoute(challengeCtl.active));
router.get(
  '/challenges/eligible-photos',
  requireAuth,
  asyncRoute(challengeCtl.eligiblePhotos)
);
router.get('/challenges/:id/entries', requireAuth, asyncRoute(challengeCtl.entries));
router.post(
  '/challenges/:id/submit',
  requireAuth,
  validate(challengeCtl.submitSchema),
  asyncRoute(challengeCtl.submit)
);

/* ----------------------------------- feed --------------------------------- */

router.get(
  '/feed',
  requireAuth,
  generalLimiter,
  validate(feedCtl.feedQuerySchema, 'query'),
  asyncRoute(feedCtl.feed)
);

// Impressions are the denominator of the engagement ratio, so they are reported by the
// client from what actually became visible, not inferred from what was served.
router.post(
  '/photos/impressions',
  requireAuth,
  generalLimiter,
  validate(feedCtl.impressionsSchema),
  asyncRoute(feedCtl.impressions)
);

/* --------------------------------- social --------------------------------- */

router.get(
  '/leaderboard',
  requireAuth,
  generalLimiter,
  validate(socialCtl.leaderboardQuerySchema, 'query'),
  asyncRoute(socialCtl.leaderboard)
);
router.get('/users/:id/public-profile', requireAuth, asyncRoute(socialCtl.profile));
router.get('/friends', requireAuth, asyncRoute(socialCtl.friends));
router.get(
  '/users/search',
  requireAuth,
  validate(socialCtl.searchQuerySchema, 'query'),
  asyncRoute(socialCtl.search)
);
router.post(
  '/friends',
  requireAuth,
  validate(socialCtl.friendRequestSchema),
  asyncRoute(socialCtl.addFriend)
);
router.post(
  '/friends/respond',
  requireAuth,
  validate(socialCtl.friendRespondSchema),
  asyncRoute(socialCtl.respond)
);
router.delete('/friends/:id', requireAuth, asyncRoute(socialCtl.unfriend));

/* ---------------------------------- shop ---------------------------------- */

router.get('/shop/catalog', requireAuth, asyncRoute(shopCtl.getCatalog));
router.post(
  '/shop/purchase',
  requireAuth,
  validate(shopCtl.purchaseSchema),
  asyncRoute(shopCtl.postPurchase)
);
