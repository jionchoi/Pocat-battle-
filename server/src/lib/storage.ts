import { config } from '../config.js';
import { supabase } from './supabase.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * The photo bucket.
 *
 * The phone uploads straight into it — storage policies check that the first path segment
 * is the caller's own id, so routing the bytes through this process would add a hop and
 * enforce nothing that Postgres is not already enforcing. What the server does instead is
 * read the object back to score it, and decide what the row says about it.
 */

export const PHOTO_BUCKET = 'cat-photos';

/**
 * Where a photo lives. `<owner>/<uuid>.jpg`.
 *
 * The uuid is the privacy boundary in a public bucket, so it must come from a real random
 * source rather than anything derived from the account or the time. `crypto.randomUUID` is
 * that; a counter or a timestamp would make one player's URLs a map to the next one's.
 */
export function photoObjectPath(ownerId: string): string {
  return `${ownerId}/${crypto.randomUUID()}.jpg`;
}

/**
 * The URL the app renders.
 *
 * Built from the path on demand rather than stored on the row. The bucket name, the host
 * and the public/private decision are all deployment details; a URL frozen into a row is a
 * row that breaks the day any of them changes, across every photo ever taken.
 */
export function publicUrlFor(storagePath: string): string {
  return `${config.SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${storagePath}`;
}

/**
 * That the caller owns the path they are claiming.
 *
 * The storage policy already stopped them writing anywhere else, but the path arrives here
 * as a string in a request body — and nothing stops a client uploading to its own folder
 * and then posting somebody else's path. Without this check that would attach another
 * player's photograph to this player's album.
 *
 * Also rejects traversal outright. `..` in a path is never legitimate and is only ever an
 * attempt to leave the folder the first segment promises.
 */
export function assertOwnedPath(storagePath: string, ownerId: string): void {
  const [folder, ...rest] = storagePath.split('/');

  if (folder !== ownerId || rest.length !== 1 || storagePath.includes('..')) {
    throw new HttpError(403, 'That photo does not belong to you.');
  }
}

/**
 * Reads an uploaded photo back out.
 *
 * The scoring call needs the bytes, and this is also the only proof the object is really
 * there: the client says it uploaded, and a client that says so wrongly — because the
 * upload failed, or because it never happened — must not produce a scored row pointing at
 * nothing.
 */
export async function downloadPhoto(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(storagePath);

  if (error || !data) {
    throw new HttpError(404, 'That photo is not in storage. Try taking it again.');
  }

  return Buffer.from(await data.arrayBuffer());
}

/**
 * Removes an object, best effort.
 *
 * Called when a row fails to write after the bytes have already landed. A failure here is
 * logged and swallowed: the alternative is failing the player's request to report that a
 * cleanup they never asked for did not happen, and the leftover is one orphaned object.
 */
export async function deletePhotoObject(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
  if (error) console.error('[storage] could not remove orphan', storagePath, error.message);
}
