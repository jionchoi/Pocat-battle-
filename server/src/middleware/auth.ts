import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { HttpError } from './errorHandler.js';

/**
 * Authentication.
 *
 * Every protected route passes through here first. It proves the caller holds a token
 * this Supabase project issued and has not expired, and puts the user id on the request.
 * Nothing downstream ever reads an id out of a body or a query string — that is the whole
 * point of this file, and the reason a service can trust `req.user!.id`.
 *
 * ## Why a key set and not a secret
 *
 * The project signs access tokens with an ECC (P-256) key, so verification uses the public
 * half published at the JWKS endpoint. Three things follow, and all three are why this is
 * the better half of the choice:
 *
 *   - the server holds no signing material, so nothing here can forge a token;
 *   - rotating to a standby key in the dashboard needs no redeploy — the new key id
 *     appears in the token header, and the set is refetched on a miss;
 *   - the symmetric alternative would put a secret capable of minting valid sessions for
 *     any user into the environment of every machine that runs this process.
 *
 * `createRemoteJWKSet` caches the keys in memory and refetches on an unknown `kid`, with
 * its own rate limiting, so this is one network call at startup rather than one per
 * request.
 */
const jwks = createRemoteJWKSet(new URL(config.SUPABASE_JWKS_URL));

/**
 * `iss` and `aud` are checked, not just the signature.
 *
 * A signature alone says "some Supabase project signed this". The issuer check says it was
 * *this* project, and the audience check rejects tokens minted for a different purpose —
 * anon tokens, service tokens — that are perfectly valid signatures but are not a
 * signed-in person.
 */
const AUDIENCE = 'authenticated';

/**
 * Slack on the clock, in seconds.
 *
 * Two machines that never agreed on the time are the normal case, not the broken one: a
 * phone's clock drifts, and the gap between a token being minted and this process deciding
 * it has expired is measured against a clock nobody synchronised. Without tolerance a device
 * running a minute fast sees its still-valid token rejected at the tail of its life, and the
 * 401 says nothing about why — the message below is deliberately identical for every cause,
 * so the failure would be invisible from both ends.
 *
 * A minute is far shorter than a token's lifetime, so this widens the window a stolen token
 * stays usable by an amount that does not matter, and closes a failure that does.
 *
 * What this does *not* fix: a token whose `iat` is in the future. jose only checks `iat` when
 * `maxTokenAge` is set, and we do not set it — so that skew was never rejected here. It is
 * rejected by PostgREST, in Supabase's own process, against Supabase's clock, and no option
 * on this call reaches it. That one is the device's clock and only the device's clock.
 */
const CLOCK_TOLERANCE_S = 60;

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new HttpError(401, 'Missing or invalid authorization header'));
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.SUPABASE_ISSUER,
      audience: AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_S,
    });

    if (!payload.sub) {
      next(new HttpError(401, 'Invalid or expired token'));
      return;
    }

    req.user = {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
    };

    next();
  } catch {
    /*
     * Deliberately one message for every failure — expired, wrong issuer, bad signature,
     * unknown key. Telling a caller *which* of those it was is telling an attacker how
     * close their forgery got. The distinction that matters to an honest client is
     * "refresh and retry", and a 401 already says that.
     */
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

/**
 * Reads a token when one is sent, and lets the request through when none is.
 *
 * For the ranked feed, which is public and identical for every reader — see the note on
 * `feedApi.viral` in the client. Requiring a token there would make the response uncacheable
 * by definition, and at scale that single header is the difference between one origin request
 * per refresh interval and one per user.
 *
 * A *bad* token is still a 401. "No credentials" and "credentials that do not verify" are
 * different statements, and quietly downgrading the second to anonymous would mean an expired
 * session silently stops showing a reader their own reactions instead of refreshing.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    next();
    return;
  }

  await authenticate(req, res, next);
}
