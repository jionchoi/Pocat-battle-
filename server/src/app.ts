import express from 'express';
import cors from 'cors';
import './types/index.js';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { floodLimit, readLimit } from './middleware/rateLimit.js';
import photosRouter from './routes/photos.js';
import albumRouter from './routes/album.js';
import catdexRouter from './routes/catdex.js';
import mapRouter from './routes/map.js';
import feedRouter from './routes/feed.js';
import challengesRouter from './routes/challenges.js';
import authRouter from './routes/auth.js';
import shopRouter from './routes/shop.js';
import pawsRouter from './routes/paws.js';
import { friendsRouter, leaderboardRouter, usersRouter } from './routes/social.js';

export const app = express();

/**
 * How far to believe `X-Forwarded-For`, and therefore what `req.ip` means.
 *
 * Set before anything that reads an address. A count, not a boolean — see `TRUST_PROXY` in
 * config.ts for why `true` would hand every per-address limit below to the caller.
 */
app.set('trust proxy', config.TRUST_PROXY);

app.use(cors());

/**
 * 64kb, where this used to say 10mb.
 *
 * No endpoint in this API carries a photograph. The phone uploads bytes straight to the
 * storage bucket and `POST /photos` is told the path afterwards, so the largest honest body
 * here is `impressions` — 200 uuids, about 9kb — and everything else is a caption or a
 * nickname. 10mb was three orders of magnitude of headroom that nothing asked for, and every
 * byte of it is memory this process buffers before a single validator has run.
 *
 * That matters more than it looks because there is no rate limiting anywhere in front of it:
 * until there is, the cheapest way to hurt this server is a stream of large bodies to a route
 * that was always going to reject them.
 */
/**
 * Liveness. No auth, no database, and deliberately above the rate limiter.
 *
 * It answers whether this process is up, and deliberately nothing else — a health check
 * that queries the database goes red during a database blip and takes the process down
 * with it, turning a degraded read path into an outage.
 *
 * Mounted before `floodLimit` for a version of the same mistake: a load balancer polls this
 * from one address, so a limited health check is one that starts answering 429 under exactly
 * the traffic it exists to report on, and the balancer reads that as a dead instance and
 * removes it. The limiter would take the service down to defend it.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cat-frame' });
});

/*
 * The outermost ceiling, before the body parser: a request that is going to be refused should
 * be refused before this process buffers and parses whatever it is carrying.
 */
app.use(floodLimit);

app.use(express.json({ limit: '64kb' }));

/*
 * `readLimit` is the floor for every authenticated router, and the tighter tiers are applied
 * per route inside them. A capture therefore spends both budgets, which is intended: the
 * narrow limit is what binds, and the broad one still counts the request as traffic.
 *
 * `/feed` is mounted bare because it is the one router with a public route — `/viral` has no
 * player to key on and takes `publicLimit` inside the router instead.
 */
app.use('/photos', readLimit, photosRouter);
app.use('/album', readLimit, albumRouter);
app.use('/catdex', readLimit, catdexRouter);
app.use('/map', readLimit, mapRouter);
app.use('/feed', feedRouter);
app.use('/challenges', readLimit, challengesRouter);
app.use('/auth', readLimit, authRouter);
app.use('/shop', readLimit, shopRouter);
app.use('/paws', readLimit, pawsRouter);
app.use('/leaderboard', readLimit, leaderboardRouter);
app.use('/users', readLimit, usersRouter);
app.use('/friends', readLimit, friendsRouter);

/**
 * Anything that matched no route above.
 *
 * Express answers an unknown path with an HTML page, which is the wrong content type for a
 * client that only ever parses JSON — so the app falls back to a generic "Something went
 * wrong. Try again.", and the one fact worth knowing is thrown away: this endpoint is not
 * built yet.
 *
 * It mattered more when most of this API was missing — the client calls thirty-six endpoints
 * and for a long time nine existed, so `not_implemented` was the commonest answer the server
 * could give. Thirty-four exist now and it is close to the rarest, which makes it more useful
 * rather than less: an app reaching this handler is reaching one of the two endpoints that are
 * deliberately unbuilt, and it should be able to tell that from something having broken.
 */
app.use((req, res) => {
  res.status(404).json({
    code: 'not_implemented',
    status: 404,
    message: `This part of Cat Frame is not built yet. (${req.method} ${req.path})`,
  });
});

// Last, always: everything above reaches error responses by calling next(err).
app.use(errorHandler);
