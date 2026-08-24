import { Router } from 'express';

import { authenticate, optionalAuth } from '../middleware/auth.js';
import { publicLimit, readLimit } from '../middleware/rateLimit.js';
import * as feedController from '../controllers/feed.js';

const router = Router();

/**
 * The chronological feed. Signed in, because `scope` and `myReaction` are both about a reader.
 */
router.get('/', authenticate, readLimit, feedController.list);

/**
 * The ranked feed, and the only route in the API that answers an anonymous caller.
 *
 * Deliberate: the response is public and identical for everyone, so dropping the requirement
 * for a token is what allows a CDN to cache it. `optionalAuth` still reads a token when one
 * is sent — a signed-in reader who happens to hit the origin gets their own `myReaction`
 * filled in rather than being treated as a stranger.
 */
router.get('/viral', optionalAuth, publicLimit, feedController.viral);

export default router;
