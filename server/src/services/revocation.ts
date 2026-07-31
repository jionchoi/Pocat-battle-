import { store } from '../redis';

/**
 * Access-token revocation for deleted accounts.
 *
 * Refresh tokens are rows, so deleting a user cascades them away instantly. Access tokens
 * are stateless JWTs — nothing to delete — so without this a deleted account stays
 * authenticated until its token expires.
 *
 * The obvious fix, "check the user exists on every request", costs a database round trip
 * on every authenticated call to close a 15-minute window. This is the cheaper standard
 * answer: a blocklist entry that expires exactly when the token would have anyway, so the
 * set stays bounded and no cleanup job is needed.
 */

/** Comfortably longer than ACCESS_TOKEN_TTL (15m), so no token outlives its entry. */
const TTL_SECONDS = 20 * 60;

function key(userId: string): string {
  return `pawgo:revoked:${userId}`;
}

export async function revokeUser(userId: string): Promise<void> {
  await store.set(key(userId), '1', TTL_SECONDS);
}

export async function isRevoked(userId: string): Promise<boolean> {
  return (await store.get(key(userId))) !== null;
}
