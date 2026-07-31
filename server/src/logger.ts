import pino from 'pino';

import { config } from './config';

export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  /**
   * Redaction is not optional. Auth bodies carry passwords and social ID tokens, and
   * catch submissions carry base64 photos that would otherwise flood the log.
   */
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.idToken',
      'req.body.photoBase64',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  transport: config.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
});
