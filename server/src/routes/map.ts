import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';
import * as mapController from '../controllers/map.js';

const router = Router();

/**
 * Sightings in a viewport.
 *
 * Authenticated, and not because the data is secret — most of it is other players' pins,
 * already coarsened. It is because the response *depends on the reader*: the viewer's own
 * captures come back at their true coordinates and everyone else's are snapped to a grid, and
 * a route with no caller identity has no way to draw that line. An anonymous version of this
 * endpoint would have to coarsen everything, which would break the one case the map is most
 * useful for — finding your way back to a cat you photographed yourself.
 *
 * `POST /map/sightings` is in the client's contract and is deliberately not here. It is a
 * bare report with no photograph behind it, it has no table, and `mapApi.report` has no caller
 * anywhere in the app — see BACKEND.md §6.
 */
router.get('/sightings', authenticate, mapController.sightings);

export default router;
