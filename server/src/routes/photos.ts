import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import { uuidParam, validate } from '../middleware/validate.js';
import { costlyLimit, writeLimit } from '../middleware/rateLimit.js';
import * as photosController from '../controllers/photos.js';
import * as votesController from '../controllers/votes.js';

const router = Router();

/**
 * How many scores are left in the rolling window, for the album and the reveal screen.
 *
 * Declared before `/:photoId`, and it has to stay there. Express matches in order, so the
 * parameterised route would otherwise swallow this one and the service would spend a query
 * looking for a photo with the id "allowance".
 */
router.get('/allowance', authenticate, photosController.allowance);

/**
 * Which photographs actually became visible.
 *
 * Declared before `/:photoId` for the same reason `/allowance` is — Express matches in order,
 * and the parameterised route would swallow it.
 */
router.post(
  '/impressions',
  authenticate,
  writeLimit,
  validate(votesController.impressionsSchema),
  votesController.impressions
);

/** A new capture. The bytes are already in storage; this is told where. */
router.post(
  '/',
  authenticate,
  costlyLimit,
  validate(photosController.captureSchema),
  photosController.capture
);

/** Spends an allowance on a photo that was stored without a score. */
router.post(
  '/:photoId/reveal',
  authenticate,
  costlyLimit,
  uuidParam('photoId'),
  photosController.reveal
);

/**
 * One photo, for the detail screen.
 *
 * Answers for two readers: the owner, who gets the album serialization, and anyone else, who
 * gets the feed one — every card in the viral feed opens this screen. See the service; the
 * difference between the two is `capturedLocation`.
 */
router.get('/:photoId', authenticate, uuidParam('photoId'), photosController.detail);

/**
 * Which cat this photograph is of — the player's answer, never the matcher's.
 *
 * Also how a mistake is corrected: calling it again with a different cat moves the photograph
 * and the reply names what it was moved off.
 */
router.post(
  '/:photoId/identify',
  authenticate,
  writeLimit,
  uuidParam('photoId'),
  validate(photosController.identifySchema),
  photosController.identify
);

/** The shortlist on its own, for identifying a photo from the album. */
router.get('/:photoId/candidates', authenticate, uuidParam('photoId'), photosController.candidates);

/** Caption, share-to-feed and showcase — the three fields the player owns. */
router.patch(
  '/:photoId',
  authenticate,
  writeLimit,
  uuidParam('photoId'),
  validate(photosController.updatePhotoSchema),
  photosController.update
);

/** A reaction to somebody else's photograph. Refused on your own. */
router.post(
  '/:photoId/vote',
  authenticate,
  writeLimit,
  uuidParam('photoId'),
  validate(votesController.voteSchema),
  votesController.vote
);

/** Removes the row, the object in the bucket, and repairs any Dex entry pointing at it. */
router.delete(
  '/:photoId',
  authenticate,
  writeLimit,
  uuidParam('photoId'),
  photosController.remove
);

export default router;
