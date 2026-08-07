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
