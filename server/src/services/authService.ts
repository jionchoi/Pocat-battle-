import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { config } from '../config';
import { prisma } from '../db/client';
import { errors } from '../errors';
import { verifyAppleIdToken, verifyGoogleIdToken } from '../integrations/socialAuth';
import { revokeUser } from './revocation';

/**
 * Auth. Node issues and verifies every token; the client holds a JWT and nothing else —
 * never a database key of any kind.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AccessClaims {
  sub: string;
  username: string;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Refresh tokens are opaque random strings, not JWTs, and only their SHA-256 hash is
 * stored. A database dump therefore yields no usable sessions, and revocation is a real
 * delete rather than a blocklist we have to check on every request.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issueTokens(user: { id: string; username: string }): Promise<TokenPair> {
  const accessToken = jwt.sign(
    { sub: user.id, username: user.username } satisfies AccessClaims,
    config.JWT_ACCESS_SECRET,
    // The TTL is a validated env string ("15m"); the typings want a narrower literal union
    // than a plain string, so the cast is here rather than weakening the config schema.
    { expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] }
  );

  const refreshToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(
    Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000
  );

  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(refreshToken), userId: user.id, expiresAt },
  });

  return { accessToken, refreshToken, expiresIn: 15 * 60 };
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
    if (typeof decoded === 'string' || !decoded.sub) {
      throw errors.unauthorized();
    }
    return { sub: String(decoded.sub), username: String(decoded.username ?? '') };
  } catch {
    throw errors.unauthorized('Your session has expired. Please sign in again.');
  }
}

export async function signup(params: {
  email: string;
  password: string;
  username: string;
}): Promise<{ tokens: TokenPair; userId: string }> {
  const email = params.email.trim().toLowerCase();
  const username = params.username.trim();

  if (!USERNAME_PATTERN.test(username)) {
    throw errors.badRequest(
      'Usernames are 3 to 20 characters, letters, numbers and underscores.'
    );
  }
  if (params.password.length < 10) {
    throw errors.badRequest('Passwords need at least 10 characters.');
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { email: true, username: true },
  });

  if (existing) {
    // Deliberately specific: this is a signup form, and a vague error here just makes
    // people retry the same thing. Account enumeration on signup is unavoidable anyway.
    throw errors.conflict(
      existing.email === email
        ? 'An account already uses that email.'
        : 'That username is taken.'
    );
  }

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash: await bcrypt.hash(params.password, 12),
      provider: 'email',
    },
    select: { id: true, username: true },
  });

  return { tokens: await issueTokens(user), userId: user.id };
}

export async function login(params: {
  email: string;
  password: string;
}): Promise<{ tokens: TokenPair; userId: string }> {
  const email = params.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, username: true, passwordHash: true },
  });

  // Same message and a real hash comparison either way, so response time and wording do
  // not reveal whether the address exists.
  const dummyHash = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = await bcrypt.compare(params.password, user?.passwordHash ?? dummyHash);

  if (!user || !user.passwordHash || !ok) {
    throw errors.unauthorized('That email and password do not match.');
  }

  return {
    tokens: await issueTokens({ id: user.id, username: user.username }),
    userId: user.id,
  };
}

/**
 * Social sign-in. Apple is mandatory on iOS if any other social provider is offered,
 * per App Store review guideline 4.8 — both are wired here.
 */
export async function socialSignIn(params: {
  provider: 'google' | 'apple';
  idToken: string;
}): Promise<{ tokens: TokenPair; userId: string; isNewAccount: boolean }> {
  const profile =
    params.provider === 'google'
      ? await verifyGoogleIdToken(params.idToken)
      : await verifyAppleIdToken(params.idToken);

  const existing = await prisma.user.findFirst({
    where: { provider: params.provider, providerSub: profile.sub },
    select: { id: true, username: true },
  });

  if (existing) {
    return {
      tokens: await issueTokens(existing),
      userId: existing.id,
      isNewAccount: false,
    };
  }

  // Apple's private relay means email may be absent or a one-time address, so the account
  // is keyed on the provider subject, never on email.
  const created = await prisma.user.create({
    data: {
      provider: params.provider,
      providerSub: profile.sub,
      email: profile.email ?? null,
      username: await uniqueUsername(profile.suggestedName ?? 'trainer'),
    },
    select: { id: true, username: true },
  });

  return {
    tokens: await issueTokens(created),
    userId: created.id,
    isNewAccount: true,
  };
}

/**
 * Refresh with rotation: the presented token is revoked as it is exchanged. A replayed
 * refresh token therefore fails, which is how token theft gets caught.
 */
export async function refresh(refreshToken: string): Promise<TokenPair> {
  const tokenHash = hashToken(refreshToken);

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, username: true } } },
  });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw errors.unauthorized('Please sign in again.');
  }

  await prisma.refreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });

  return issueTokens(record.user);
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken
    .update({
      where: { tokenHash: hashToken(refreshToken) },
      data: { revokedAt: new Date() },
    })
    // Signing out with an already-invalid token is not an error worth surfacing.
    .catch(() => undefined);
}

export async function setUsername(params: {
  userId: string;
  username: string;
  avatarUrl?: string;
}): Promise<{ username: string; avatarUrl: string }> {
  const username = params.username.trim();

  if (!USERNAME_PATTERN.test(username)) {
    throw errors.badRequest(
      'Usernames are 3 to 20 characters, letters, numbers and underscores.'
    );
  }

  const taken = await prisma.user.findFirst({
    where: { username, id: { not: params.userId } },
    select: { id: true },
  });

  if (taken) throw errors.conflict('That username is taken.');

  const updated = await prisma.user.update({
    where: { id: params.userId },
    data: { username, avatarUrl: params.avatarUrl },
    select: { username: true, avatarUrl: true },
  });

  return updated;
}

async function uniqueUsername(base: string): Promise<string> {
  const cleaned = base.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 14) || 'trainer';

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate =
      attempt === 0 ? cleaned : `${cleaned}_${randomBytes(2).toString('hex')}`;

    const exists = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });

    if (!exists) return candidate;
  }

  return `trainer_${randomBytes(4).toString('hex')}`;
}

/**
 * Account deletion (README section 5.6 — Privacy & Data).
 *
 * Cascades handle everything the player owns: photos, dex entries, votes, sightings,
 * cosmetics and the XP ledger all carry `onDelete: Cascade`, and the ledger goes with
 * the account because it is personal data.
 *
 * The one thing that survives is the global `Cat` rows this player discovered. Those are
 * shared records of real animals that other players have their own photos and Dex
 * entries for — deleting them would silently destroy other people's albums. The
 * `discoveredByUserId` relation is deliberately the exception, and is reassigned to the
 * earliest remaining photographer so the record keeps a valid owner.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const discovered = await tx.cat.findMany({
      where: { discoveredByUserId: userId },
      select: { id: true },
    });

    for (const cat of discovered) {
      const heir = await tx.catDexEntry.findFirst({
        where: { catId: cat.id, userId: { not: userId } },
        orderBy: { firstSeenAt: 'asc' },
        select: { userId: true },
      });

      if (heir) {
        await tx.cat.update({
          where: { id: cat.id },
          data: { discoveredByUserId: heir.userId },
        });
      } else {
        // Nobody else has photographed this cat, so nothing is lost by removing it.
        await tx.cat.delete({ where: { id: cat.id } });
      }
    }

    await tx.user.delete({ where: { id: userId } });
  });

  // Only after the row is gone — revoking first would lock out an account whose deletion
  // then failed and rolled back.
  await revokeUser(userId);
}
