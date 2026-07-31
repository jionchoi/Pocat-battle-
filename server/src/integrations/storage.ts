import { randomUUID } from 'node:crypto';

import { config } from '../config';
import { errors } from '../errors';
import { logger } from '../logger';

/**
 * Cat photo storage.
 *
 * The client never receives a storage key or direct write access. It sends the image to
 * Node with the catch submission, and Node writes it — which also means Node has the bytes
 * in hand for the Vision check, with no round trip to fetch what the client uploaded.
 *
 * `signedUploadUrl` exists for larger future assets where proxying through Node would be
 * wasteful; it issues a short-lived, single-path token rather than a bucket credential.
 */

const MAX_BYTES = 3 * 1024 * 1024;

export interface StoredPhoto {
  /** Public/CDN URL the app renders. */
  url: string;
  /** Bucket object path, kept so the blob can be deleted with its row. */
  objectPath: string;
}

export async function uploadCatPhoto(params: {
  userId: string;
  photoBase64: string;
}): Promise<StoredPhoto> {
  const buffer = Buffer.from(params.photoBase64, 'base64');

  if (buffer.byteLength === 0) {
    throw errors.badRequest('That photo was empty.');
  }
  if (buffer.byteLength > MAX_BYTES) {
    throw errors.badRequest('That photo is too large. The app should downscale first.');
  }
  if (!isJpeg(buffer) && !isPng(buffer)) {
    // Magic-byte check, not a filename check. A client-declared content type is a claim.
    throw errors.badRequest('Only JPEG and PNG photos are accepted.');
  }

  const objectPath = `${params.userId}/${Date.now()}-${randomUUID()}.jpg`;

  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    // Local development without storage configured. The capture still works end to end
    // and still gets a real score; the card just shows its empty-photo state.
    logger.warn('Storage is not configured — returning a placeholder photo URL');
    return { url: '', objectPath: '' };
  }

  const endpoint = `${config.SUPABASE_URL}/storage/v1/object/${config.SUPABASE_STORAGE_BUCKET}/${objectPath}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': isPng(buffer) ? 'image/png' : 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: buffer,
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, 'photo upload failed');
    throw errors.unavailable('We could not save that photo. Try again shortly.');
  }

  return { url: publicUrlFor(objectPath), objectPath };
}

/**
 * Removes a stored blob.
 *
 * Called when a player deletes a photo, and when a capture transaction fails after the
 * upload succeeded. Failures are logged rather than thrown: an orphaned object is a
 * storage-cost problem, while a thrown error here would turn a successful delete into a
 * failed request the player cannot resolve.
 */
export async function deleteStoredPhoto(objectPath: string): Promise<void> {
  if (!objectPath) return;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return;

  const endpoint = `${config.SUPABASE_URL}/storage/v1/object/${config.SUPABASE_STORAGE_BUCKET}/${objectPath}`;

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}` },
  });

  if (!response.ok && response.status !== 404) {
    logger.error(
      { status: response.status, objectPath },
      'photo delete failed — object may be orphaned'
    );
  }
}

export function publicUrlFor(objectPath: string): string {
  if (config.PHOTO_CDN_BASE_URL) {
    return `${config.PHOTO_CDN_BASE_URL.replace(/\/$/, '')}/${objectPath}`;
  }
  return `${config.SUPABASE_URL}/storage/v1/object/public/${config.SUPABASE_STORAGE_BUCKET}/${objectPath}`;
}

/**
 * Short-lived signed upload URL, scoped to one object path.
 * Not used by the catch flow — kept for future large-asset uploads.
 */
export async function signedUploadUrl(params: {
  userId: string;
  extension: 'jpg' | 'png';
}): Promise<{ uploadUrl: string; objectPath: string; expiresInSeconds: number }> {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw errors.unavailable('Photo storage is not configured.');
  }

  const objectPath = `${params.userId}/${Date.now()}-${randomUUID()}.${params.extension}`;

  const response = await fetch(
    `${config.SUPABASE_URL}/storage/v1/object/upload/sign/${config.SUPABASE_STORAGE_BUCKET}/${objectPath}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 120 }),
    }
  );

  if (!response.ok) {
    throw errors.unavailable('We could not prepare that upload.');
  }

  const json = (await response.json()) as { url?: string };
  if (!json.url) throw errors.unavailable('We could not prepare that upload.');

  return {
    uploadUrl: `${config.SUPABASE_URL}/storage/v1${json.url}`,
    objectPath,
    expiresInSeconds: 120,
  };
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}
