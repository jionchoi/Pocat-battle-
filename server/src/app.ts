import express from 'express';
import cors from 'cors';
import './types/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import photosRouter from './routes/photos.js';
import albumRouter from './routes/album.js';
import catdexRouter from './routes/catdex.js';
import mapRouter from './routes/map.js';
import feedRouter from './routes/feed.js';
import challengesRouter from './routes/challenges.js';
import authRouter from './routes/auth.js';
import shopRouter from './routes/shop.js';
import { friendsRouter, leaderboardRouter, usersRouter } from './routes/social.js';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

/**
 * Liveness. No auth, no database.
 *
 * It answers whether this process is up, and deliberately nothing else — a health check
 * that queries the database goes red during a database blip and takes the process down
 * with it, turning a degraded read path into an outage.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cat-frame' });
});

app.use('/photos', photosRouter);
app.use('/album', albumRouter);
app.use('/catdex', catdexRouter);
app.use('/map', mapRouter);
app.use('/feed', feedRouter);
app.use('/challenges', challengesRouter);
app.use('/auth', authRouter);
app.use('/shop', shopRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/users', usersRouter);
app.use('/friends', friendsRouter);

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
