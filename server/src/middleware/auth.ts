import type { NextFunction, Request, Response } from 'express';

import { errors } from '../errors';
import { verifyAccessToken } from '../services/authService';
import { isRevoked } from '../services/revocation';

/**
 * Bearer token verification. Attaches the caller's identity to the request.
 *
 * Everything downstream reads `req.auth.userId` and never a user id from the body or
 * query — that is the difference between "who you say you are" and "who you are".
 */

export interface AuthContext {
  userId: string;
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(errors.unauthorized('Sign in to continue.'));
    return;
  }

  let claims;
  try {
    claims = verifyAccessToken(header.slice('Bearer '.length).trim());
  } catch (err) {
    next(err);
    return;
  }

  // A deleted account's JWT stays cryptographically valid until it expires. This closes
  // that window without a database round trip on every request.
  isRevoked(claims.sub)
    .then((revoked) => {
      if (revoked) {
        next(errors.unauthorized('That account no longer exists.'));
        return;
      }
      req.auth = { userId: claims.sub, username: claims.username };
      next();
    })
    .catch(() => {
      // The store being unreachable must not lock every player out. The blocklist is a
      // 15-minute hardening measure, not the primary auth check.
      req.auth = { userId: claims.sub, username: claims.username };
      next();
    });
}

/** For endpoints that behave differently when signed in but do not require it. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (header?.startsWith('Bearer ')) {
    try {
      const claims = verifyAccessToken(header.slice('Bearer '.length).trim());
      req.auth = { userId: claims.sub, username: claims.username };
    } catch {
      // An invalid token on an optional route is treated as anonymous rather than a 401.
    }
  }

  next();
}

/** Narrowing helper so controllers do not repeat the non-null assertion. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw errors.unauthorized();
  return req.auth;
}
