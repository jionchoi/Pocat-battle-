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
