import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as challengesController from '../controllers/challenges.js';

const router = Router();

/**
 * The hub: what is running, what has finished, who is ahead, and the player's streak.
 *
 * This is also where closed challenges get their winners — settlement is lazy and happens on
 * read, which is why there is no scheduled job anywhere in this codebase. See the service.
 */
router.get('/active', authenticate, challengesController.active);

/**
 * Photos that could be entered. Declared before `/:challengeId/...` so Express does not
 * match "eligible-photos" as a challenge id — the same ordering rule `/photos/allowance` has.
 */
router.get('/eligible-photos', authenticate, challengesController.eligiblePhotos);

router.get('/:challengeId/entries', authenticate, challengesController.entries);

/** Enters a photo, or moves an existing entry onto it. Also shares it to the feed. */
router.post(
  '/:challengeId/submit',
  authenticate,
  validate(challengesController.submitSchema),
  challengesController.submit
);

export default router;
