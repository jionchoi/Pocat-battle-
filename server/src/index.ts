import { createServer } from 'node:http';

import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { config } from './config';
import { disconnectDb } from './db/client';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { store } from './redis';
import { router } from './routes';
import { startJobs } from './jobs';

const app = express();

app.disable('x-powered-by');
// Behind Railway/Render/Fly the client IP arrives in X-Forwarded-For; without this the
// rate limiter buckets every request under the load balancer's address.
app.set('trust proxy', 1);

app.use(helmet());
app.use(pinoHttp({ logger }));

// Submissions carry a base64 photo, so the default 100kb limit is far too small. The
// ceiling is deliberate — the schema and storage layer both reject anything larger.
app.use(express.json({ limit: '5mb' }));

app.use(router);
app.use(notFoundHandler);
app.use(errorHandler);

// A plain HTTP server: dropping the battle system removed the only thing that needed a
// persistent connection, so there is no socket layer to attach (README section 2a).
const server = createServer(app);
const stopJobs = startJobs();

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'catsnap api listening');
});

/**
 * Graceful shutdown. Platforms send SIGTERM and then kill the process a short time later,
 * so in-flight requests need a window to finish and the database pool needs to close
 * cleanly — otherwise every deploy leaks connections against the pgbouncer limit.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'shutting down');

  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();

  try {
    stopJobs();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await store.quit();
    await disconnectDb();
    clearTimeout(force);
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});

process.on('uncaughtException', (err) => {
  // An uncaught exception leaves the process in an unknown state. Log it and let the
  // platform restart us rather than continuing to serve from a broken runtime.
  logger.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException');
});
