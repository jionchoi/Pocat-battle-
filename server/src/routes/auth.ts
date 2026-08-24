import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { dangerLimit, writeLimit } from '../middleware/rateLimit.js';
import * as accountController from '../controllers/account.js';

const router = Router();

/**
 * What is left of auth on our side.
 *
 * Signing up, signing in, refreshing and signing out are gone — Supabase issues and rotates
 * the session and the app talks to it directly, so an endpoint of ours in front of that would
 * be a second implementation of the one thing we deliberately stopped writing.
 *
 * What remains is the work needing a key the app must never hold, or state the database does
 * not let the app write: deleting the account, and the three settings the 2026-08-13 column
 * grant deliberately keeps out of the app's reach.
 */
router.delete('/account', authenticate, dangerLimit, accountController.deleteAccount);

router.put(
  '/push-token',
  authenticate,
  writeLimit,
  validate(accountController.pushTokenSchema),
  accountController.setPushToken
);

router.put(
  '/home-location',
  authenticate,
  writeLimit,
  validate(accountController.homeLocationSchema),
  accountController.setHomeLocation
);

router.get('/preferences', authenticate, accountController.preferences);
router.patch(
  '/preferences',
  authenticate,
  writeLimit,
  validate(accountController.preferencesSchema),
  accountController.setPreferences
);

export default router;
