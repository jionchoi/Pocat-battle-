import * as ImageManipulator from 'expo-image-manipulator';

import { supabase } from './supabase';
import { CAPTURE_CONFIG } from '../constants/game';

/**
 * Getting a capture into storage.
 *
 * The phone uploads straight to the bucket. Storage policies check that the first segment
 * of the path is the uploader's own id, so the server would be enforcing nothing that
 * Postgres is not already enforcing — it would only be standing in the way of the bytes.
 *
 * ## What this replaces
 *
 * The old flow read the file, base64-encoded it, and sent it in the body of `POST /photos`.
 * Base64 inflates a payload by a third, and every full-size cat photo then travelled
 * through the API process's memory on its way to storage. On a phone on mobile data that
 * is the slowest part of the capture, and it scaled with the number of players rather than
 * with anything useful.
 *
 * Now the body carries a path. The bytes never touch our server on the way in; it fetches
 * them from storage when it scores them, on a connection between two datacentres.
 */

const BUCKET = 'cat-photos';

export interface UploadedPhoto {
  /** `<user_id>/<uuid>.jpg` — what `POST /photos` is told about. */
  storagePath: string;
  /** The downscaled local file, for the reveal to render while the score is fetched. */
  localUri: string;
}

/**
 * Downscales the capture and puts it in the bucket.
 *
 * The resize is not only about upload time. The scoring call is billed by image size, and
 * a model judging framing, light and a coat pattern gains nothing from a 4032px original —
 * so the file that reaches storage is the file that gets scored, and both are cheaper for
 * the same reason.
 */
export async function uploadCapture(localFileUri: string, userId: string): Promise<UploadedPhoto> {
  const processed = await ImageManipulator.manipulateAsync(
    localFileUri,
    [{ resize: { width: CAPTURE_CONFIG.maxPhotoEdge } }],
    {
      base64: true,
      compress: CAPTURE_CONFIG.jpegQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  if (!processed.base64) throw new Error('We could not process that photo.');

  const storagePath = `${userId}/${randomId()}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, toBytes(processed.base64), {
      contentType: 'image/jpeg',
      // No upsert. A path is minted fresh for every capture, so a collision would mean the
      // id source is broken — and silently overwriting somebody's photo is the worst
      // possible response to that.
      upsert: false,
    });

  if (error) throw error;

  return { storagePath, localUri: processed.uri };
}

/**
 * base64 to bytes.
 *
 * `Blob` and `File` are the obvious way to hand bytes to the SDK and are not dependable in
 * React Native — a Blob built from a data URI arrives at the server as zero bytes on some
 * versions, which fails as a silently empty image rather than as an error. A typed array
 * is unambiguous on every runtime this app runs on.
 */
function toBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * The uuid in the path, and the only thing standing between a photo and anyone who guesses
 * a URL — the bucket is public, so this has to come from a real random source rather than
 * from the clock or the account.
 */
function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // Hermes exposes getRandomValues even where randomUUID is missing. Falling back to
  // Math.random would make paths predictable, which in a public bucket is the whole
  // security boundary — so this throws rather than degrading quietly.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
