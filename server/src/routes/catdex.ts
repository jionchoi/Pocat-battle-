import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as catdexController from '../controllers/catdex.js';

const router = Router();

/**
 * The Cat Dex — the player's own entries, never the `cats` table.
 *
 * Its own router rather than routes under `/photos`, because a cat outlives any one
 * photograph of it: identifying happens on a photo and belongs there, and everything here is
 * about the animal afterwards.
 *
 * Every route is authenticated, and every one of them filters on the caller's `user_id`
 * before it reads anything. A cat id is not a capability — knowing one gets you nothing you
 * have not photographed yourself.
 */
router.get('/', authenticate, catdexController.list);
router.get('/:catId', authenticate, catdexController.profile);
router.patch(
  '/:catId',
  authenticate,
  validate(catdexController.updateCatSchema),
  catdexController.update
);

export default router;
