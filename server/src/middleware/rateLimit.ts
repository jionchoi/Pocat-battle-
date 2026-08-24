import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';

import { config } from '../config.js';
import { RATE_LIMITS, type Tier, type TierName } from '../game/limits.js';
import { HttpError } from './errorHandler.js';

/**
 * Rate limiting.
 *
 * ## Why the key is usually the player and not the address
 *
 * This is a phone app, and phones are behind carrier-grade NAT. Tens of thousands of
 * subscribers on one mobile network share a handful of public addresses, so an address-keyed
 * limit tuned for one person is a limit that locks out a city — and one tuned so a city fits
 * through it is not a limit. The address is the wrong identity for almost everything here.
 *
 * `authenticate` has already run on every route below except the public feed, so the honest
 * identity is `req.user.id`: it is derived from a signature this server verified, it cannot be
 * spoofed, and it costs an account to get another one. Address keying is kept for exactly two
 * jobs it is actually good at — the public feed, which has no user, and the outermost flood
 * stop, which is about the pipe rather than about fairness.
 *
 * The tiers themselves — the windows, the counts and the reasoning for each — are in
 * `game/limits.ts`. This file holds no numbers.
 *
 * ## The store is per-process, and that is a real limit
 *
 * Counters live in this process's memory. Two instances behind a load balancer each enforce
 * their own copy, so the effective ceiling is each tier times the number of instances,
 * and a deploy resets every counter. That is the accepted trade while this deploys as one
 * stateless container: the alternative is Redis, which is a dependency, a cost and a thing to
 * operate, bought for an app with no users yet. Revisit it when there is a second instance —
 * `express-rate-limit` takes a store, so it is a constructor argument rather than a rewrite.
 */

/* -------------------------------------------------------------------------- */
/* The shared shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A refusal in the envelope the app already understands.
 *
 * The default handler sends `text/plain`, and this client only ever parses JSON — it would
 * read a refusal as a transport failure and show "Something went wrong. Try again.", which is
 * both wrong and the one message that invites the retry the limit is trying to stop.
 * `codeForStatus` already maps 429 to `rate_limited`, so going through `HttpError` puts a
 * stable code beside a sentence written for a person.
 */
function refuse(message: string) {
  return (_req: Request, _res: Response, next: (err: Error) => void) => {
    next(new HttpError(429, message));
  };
}

/**
 * Per player, falling back to the address when there is no player.
 *
 * The fallback matters more than it looks. A limiter keyed on `req.user.id` alone returns
 * `undefined` for an unauthenticated request and every such request shares one bucket, so a
 * single bad caller exhausts it and the route is closed to everybody. These limiters all sit
 * behind `authenticate`, so that should be unreachable — "should be" is why the fallback is
 * here rather than a comment saying it cannot happen.
 *
 * `ipKeyGenerator` rather than `req.ip` directly: IPv6 hands a single subscriber a whole /64,
 * so keying on the full address lets one caller walk through billions of distinct keys. It
 * normalises to the prefix that actually identifies them.
 */
function byPlayer(req: Request): string {
  return req.user?.id ?? `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

function byAddress(req: Request): string {
  return ipKeyGenerator(req.ip ?? '');
}

/**
 * Builds one limiter from a tier. The numbers live in `game/limits.ts`; this is the wiring.
 */
function limiterFor(name: TierName): RequestHandler {
  const tier: Tier = RATE_LIMITS[name];

  const options: Partial<Options> = {
    windowMs: tier.windowMs,
    limit: tier.limit,
    keyGenerator: tier.byAddress ? byAddress : byPlayer,
    handler: refuse(tier.message),

    // `RateLimit-*`, which tells an honest client what it has left. The `X-RateLimit-*` pair
    // is the older draft and nothing here reads it.
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    /*
     * A refused request still counts. Not counting them means a caller already over the limit
     * pays nothing for continuing to hammer, which is precisely the behaviour being limited —
     * and it is what makes a stuck retry loop expensive for the client rather than for us.
     */
    skipFailedRequests: false,
    skipSuccessfulRequests: false,

    skip: () => config.RATE_LIMIT_DISABLED,
  };

  return rateLimit(options);
}

/* -------------------------------------------------------------------------- */
/* The tiers                                                                  */
/* -------------------------------------------------------------------------- */

/** Outermost, before the routers. See `RATE_LIMITS.flood`. */
export const floodLimit = limiterFor('flood');

/** The floor for every authenticated router. */
export const readLimit = limiterFor('read');

/** Anything that writes a row somebody else can see. */
export const writeLimit = limiterFor('write');

/** Captures and reveals — the paths that end at a paid model call. */
export const costlyLimit = limiterFor('costly');

/** Friend requests, responses, and user search. */
export const socialLimit = limiterFor('social');

/** Irreversible account actions. */
export const dangerLimit = limiterFor('danger');

/** The public ranked feed, keyed by address because there is no player. */
export const publicLimit = limiterFor('public');
