import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import * as pawsController from '../controllers/paws.js';

const router = Router();

/**
 * The wallet.
 *
 * Only the balance lives here; **giving** hangs off the photograph it is given to, in
 * `routes/photos.ts`, for the same reason reacting does — the subject of the request is
 * somebody else's photograph, not the caller's account.
 *
 * There is no spending endpoint. Reveals, cosmetics and challenge entry fees all need an
 * entitlements table that does not exist yet (`ownsEntry` in `game/shop.ts` explains), and
 * shipping a spend without somewhere to record what was bought would take money for nothing.
 * Until then this router is one route, and that is the honest size of it.
 */
router.get('/balance', authenticate, pawsController.balance);

export default router;
