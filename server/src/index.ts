import { config } from './config.js';
import { app } from './app.js';

/**
 * Process entry point.
 *
 * Importing `config` first is load-bearing: it validates the environment and exits on a
 * bad one, so the server never reaches `listen` in a state where the first request would
 * have discovered the problem instead.
 */
function bootstrap() {
  const port = Number(config.PORT);

  app.listen(port, () => {
    console.log(`Cat Frame server listening on port ${port} (${config.NODE_ENV})`);
  });
}

bootstrap();
