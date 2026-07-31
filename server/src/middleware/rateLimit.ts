import rateLimit from 'express-rate-limit';

import { errors } from '../errors';

/**
 * Rate limits.
 *
 * Auth is limited hardest because it is the credential-stuffing surface. Photo
 * submissions have their own per-user limit inside captureService (Redis-backed, shared
 * across instances); this layer is the cruder per-IP guard in front of it, and it also
 * caps what an unauthenticated flood can cost us in Vision calls.
 */

const handler = () => {
  throw errors.tooMany();
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

export const captureLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/** Map viewport requests fire on every pan, so this ceiling is generous by design. */
export const mapLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
