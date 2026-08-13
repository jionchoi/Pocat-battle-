import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import * as albumController from '../controllers/album.js';

const router = Router();

/**
 * The player's own photos, paged.
 *
 * Its own router rather than a route on `/photos`, because the client's contract puts it at
 * `/album` — one collection is "the things I have captured" and the other is "this photo",
 * and the filters only ever belong to the first.
 */
router.get('/', authenticate, albumController.list);

export default router;
