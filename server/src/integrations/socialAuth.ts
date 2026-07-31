import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { config } from '../config';
import { errors } from '../errors';

/**
 * Social ID token verification.
 *
 * Both providers are verified against their published keys — a client-supplied token is
 * never decoded and trusted. `audience` checks matter as much as the signature: a valid
 * Google token issued for a different app would otherwise be accepted here.
 */

export interface SocialProfile {
  sub: string;
  email: string | null;
  suggestedName: string | null;
}

const googleClient = new OAuth2Client();

export async function verifyGoogleIdToken(idToken: string): Promise<SocialProfile> {
  if (config.googleClientIds.length === 0) {
    throw errors.unavailable('Google sign-in is not configured.');
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.googleClientIds,
    });

    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error('missing sub');

    return {
      sub: payload.sub,
      email: payload.email ?? null,
      suggestedName: payload.given_name ?? payload.name ?? null,
    };
  } catch {
    throw errors.unauthorized('That Google sign-in could not be verified.');
  }
}

const appleKeys = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 24 * 3600 * 1000,
  rateLimit: true,
});

export async function verifyAppleIdToken(idToken: string): Promise<SocialProfile> {
  const decoded = jwt.decode(idToken, { complete: true });

  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw errors.unauthorized('That Apple sign-in could not be verified.');
  }

  let publicKey: string;
  try {
    const key = await appleKeys.getSigningKey(decoded.header.kid);
    publicKey = key.getPublicKey();
  } catch {
    throw errors.unavailable('Apple sign-in is temporarily unavailable.');
  }

  try {
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
      audience: config.APPLE_BUNDLE_ID,
    });

    if (typeof payload === 'string' || !payload.sub) {
      throw new Error('missing sub');
    }

    const email =
      typeof payload.email === 'string' ? payload.email : null;

    return {
      sub: String(payload.sub),
      email,
      // Apple sends the display name once, at first authorisation, in the authorization
      // response rather than the ID token — so there is nothing to read here.
      suggestedName: null,
    };
  } catch {
    throw errors.unauthorized('That Apple sign-in could not be verified.');
  }
}
