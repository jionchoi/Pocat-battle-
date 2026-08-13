import { config } from './config.js';
import { app } from './app.js';

/**
 * Process entry point.
 *
 * Importing `config` first is load-bearing: it validates the environment and exits on a
 * bad one, so the server never reaches `listen` in a state where the first request would
 * have discovered the problem instead.
 */
const port = Number(config.PORT);

const server = app.listen(port, () => {
  console.log(`Cat Frame server listening on port ${port} (${config.NODE_ENV})`);
});

/**
 * `listen` reports failures through an event, not a throw.
 *
 * Without this the most ordinary mistake there is — a server already running in another
 * terminal — surfaces as an uncaught exception and a stack trace through Node internals,
 * which says nothing about the port. Exit 1 so a supervisor treats it as the failure it is.
 */
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process or set PORT.`);
  } else {
    console.error('Server failed to start:', err.message);
  }

  process.exit(1);
});

/**
 * Stop taking new work, let what is in flight finish, then go.
 *
 * Every host worth deploying to sends SIGTERM and waits a bounded time before SIGKILL. Node's
 * default handler for SIGTERM is to exit immediately, which drops every request currently open
 * — and on this server the request most likely to be open is a capture, because it is the
 * slowest thing here by an order of magnitude: a storage read plus a model call, up to
 * `TIMEOUT_MS`.
 *
 * Losing one of those mid-flight is not a dropped connection. `applyScore` increments
 * `scoring_attempts` *before* the call, on purpose, so a capture killed after that increment
 * has spent one of the photograph's three attempts on a deploy. Two unlucky deploys and the
 * player is told their photo cannot be scored.
 */
const SHUTDOWN_GRACE_MS = 30_000;

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  // A second Ctrl-C should not restart the countdown, and a supervisor sending both TERM and
  // INT should not run this twice.
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received — finishing in-flight requests.`);

  /*
   * Longer than the scoring timeout would be honest and useless: hosts kill at their own
   * deadline regardless, and thirty seconds is inside every default. A capture that started
   * moments before the signal may still be cut off; nothing here can prevent that, and the
   * photograph is already in storage and revealable either way.
   */
  const forced = setTimeout(() => {
    console.error('Shutdown timed out with requests still open. Exiting anyway.');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);

  // Does not interrupt anything in flight — it stops accepting new connections and fires once
  // the open ones close.
  server.close((err) => {
    clearTimeout(forced);

    if (err) {
      console.error('Shutdown failed:', err.message);
      process.exit(1);
    }

    console.log('Closed cleanly.');
    process.exit(0);
  });

  // Nothing else needs draining. There is no scheduled work in this codebase — challenge
  // settlement is lazy, on read — and Supabase is reached over HTTP with no pool to close.
  forced.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
