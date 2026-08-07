import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as photosController from '../controllers/photos.js';

const router = Router();

/** How many scores are left in the rolling window, for the album and the reveal screen. */
router.get('/allowance', authenticate, photosController.allowance);

/** A new capture. The bytes are already in storage; this is told where. */
router.post(
  '/',
  authenticate,
  validate(photosController.captureSchema),
  photosController.capture
);

/** Spends an allowance on a photo that was stored without a score. */
router.post('/:photoId/reveal', authenticate, photosController.reveal);

export default router;
