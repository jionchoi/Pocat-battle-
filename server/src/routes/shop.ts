import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import * as shopController from '../controllers/shop.js';

const router = Router();

/**
 * The shop.
 *
 * Authenticated, even though the catalogue itself is the same list for everybody — `owned` and
 * `photographerRank` are answers about the person asking, and there is no version of this
 * response that is not about them.
 *
 * `POST /shop/purchase` is **not mounted on purpose**. It grants Pro, and validating the
 * receipt against Apple and Google is the whole of its security; until that exists it falls
 * through to the JSON 404, which tells the client it is not built rather than granting
 * anything. See §6.
 */
router.get('/catalog', authenticate, shopController.catalog);

export default router;
