import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimit } from '../middleware/rateLimit.js';
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
 *
 * `POST /shop/unlock` **is** mounted, and the difference between the two is worth being clear
 * about: it spends paws, which is a currency this server issued and can account for on its own
 * — there is no third party to validate against, so there is no stub to ship. It also cannot
 * reach Pro, which carries no paw price and must never carry one.
 */
router.get('/catalog', authenticate, shopController.catalog);

/**
 * Spends paws on one catalogue item.
 *
 * `writeLimit` rather than `costlyLimit`: it writes two rows and calls nothing that costs
 * money. The thing being protected is the player's own balance, and that is protected by the
 * balance, not by the limiter.
 */
router.post(
  '/unlock',
  authenticate,
  writeLimit,
  validate(shopController.unlockSchema),
  shopController.unlock
);

export default router;
