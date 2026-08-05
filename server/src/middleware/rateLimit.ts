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

/**
 * The public viral feed.
 *
 * Two things make this endpoint different from every other one here, and both push the
 * ceiling up rather than down:
 *
 *  - It is meant to sit behind a CDN. What reaches origin is a cache fill, not a user, so
 *    a limit tuned to human browsing rates would throttle the edge itself. The edge is
 *    also where an abusive flood is actually absorbed — origin never sees it.
 *  - It is cheap. A hit is one Redis `GET` of a prebuilt string, so the marginal cost of
 *    allowing it is close to nothing, unlike an auth attempt or a Vision call.
 *
 * It is still limited rather than open: a single address hammering cache misses at deep
 * offsets can still cost real database reads.
 */
export const feedLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/**
 * Known limitation, deliberately left: these counters are per-process, because
 * `express-rate-limit` defaults to an in-memory store. Across a fleet of N instances the
 * effective allowance is N times what is written here.
 *
 * That is tolerable for the coarse per-IP guards above — they exist to stop a single
 * abusive client, and being 4× looser than stated still stops one — but it is *not* how
 * the limits that carry real cost are enforced. Photo submission (Vision spend) and the
 * daily reaction ceiling (anti-brigading) both run on Redis counters in their services,
 * shared across every instance. Anything expensive or exploitable belongs there, not here.
 */
