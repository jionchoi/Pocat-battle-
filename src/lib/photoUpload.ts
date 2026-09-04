import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';

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

/** A frame straight off the camera, as `takePictureAsync` hands it over. */
export interface CaptureSource {
  uri: string;
  /** The sensor's own pixel dimensions. `0` where the camera declined to say. */
  width: number;
  height: number;
}

/**
 * The shape every photograph is saved in, as long-edge : short-edge.
 *
 * A phone sensor shoots 4:3 and the viewfinder is the whole of a ~19.5:9 screen, so neither of
 * those is a shape to keep a photograph in — 4:3 holds more than the player framed, and 19.5:9
 * is a screen's proportions rather than a picture's, and would look like a sliver anywhere it
 * is shown that is not this phone.
 *
 * 16:9 is the picture ratio between the two, and it is close enough to the viewfinder that
 * what gets kept is very nearly what was on the glass — the file holds about a fifth more
 * across than the preview showed, which errs in the safe direction. Cropping the other way
 * would cut off framing the player could see and chose.
 */
const TARGET_RATIO = 16 / 9;

/**
 * Downscales the capture and puts it in the bucket.
 *
 * The resize is not only about upload time. The scoring call is billed by image size, and
 * one file serves both purposes — what reaches storage is what gets scored, and what the
 * album renders.
 *
 * That coupling is why this was set too aggressively: the number was chosen for what a model
 * needs to judge framing and a coat pattern, and it silently decided what a person sees when
 * they open their own photograph. Those are not the same requirement, and the player's is the
 * higher one. If scoring cost becomes the binding constraint, downsample at the scoring call
 * rather than here — degrading the stored photograph to save on a request is paying for it in
 * the one place the player can see.
 */
export async function uploadCapture(source: CaptureSource, userId: string): Promise<UploadedPhoto> {
  /*
   * The contextual API, not the deprecated `manipulateAsync`.
   *
   * Transformations are queued on the context and run on a background thread when
   * `renderAsync` is awaited, so neither the crop nor the resize blocks JS while a
   * multi-megapixel capture is resampled. `saveAsync` encodes and writes the file.
   *
   * Crop before resize, and not only because it is cheaper to resample fewer pixels: `resize`
   * takes a width and derives the height from the *current* ratio, so resizing first would fix
   * the height against 4:3 and the crop would then take the file under the target width.
   */
  const context = ImageManipulator.manipulate(source.uri);

  const rect = sixteenNineCrop(source.width, source.height);
  if (rect) context.crop(rect);

  const rendered = await context
    .resize({ width: CAPTURE_CONFIG.maxPhotoWidth })
    .renderAsync();

  const processed = await rendered.saveAsync({
    base64: true,
    compress: CAPTURE_CONFIG.jpegQuality,
    format: SaveFormat.JPEG,
  });

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
      /*
       * Five minutes, and set deliberately rather than left to the platform's one hour.
       *
       * The content at a given path never changes — a fresh uuid per capture, no upsert —
       * so on the merits this should cache for a year. It does not, and the reason is
       * deletion: the bucket is public, so a cached object keeps answering requests from
       * anyone holding the URL for as long as the edge keeps it, and "delete" has to mean
       * gone rather than gone-in-an-hour.
       *
       * Five minutes is the compromise. It is long enough that scrolling an album is served
       * from the edge rather than the origin, and short enough that a deletion is real
       * before a player has finished being annoyed about the photo.
       *
       * This is a floor on exposure, not a guarantee: Supabase's Smart CDN invalidates on
       * delete, which would make the window nil, but that is plan-dependent and not
       * something the privacy story should quietly rest on. On a plan that does invalidate,
       * this value can go up.
       */
      cacheControl: '300',
    });

  if (error) throw error;

  return { storagePath, localUri: processed.uri };
}

/**
 * The centred 16:9 rectangle inside a frame of `width` x `height`.
 *
 * Orientation-agnostic on purpose. `takePictureAsync` reports the frame the way the device
 * happens to hold it, and a portrait capture arrives portrait on most phones and landscape on
 * some — so this reasons in long edge and short edge rather than in width and height, and puts
 * the answer back on whichever axis it came from. 16:9 is the more elongated of the two
 * shapes, so the long edge survives whole and the short one is what gets trimmed.
 *
 * Centred rather than anchored, because the viewfinder is centred on the same frame — an
 * anchored crop would quietly shift every photograph away from what the player aimed at.
 *
 * Returns `null` when there is nothing to do or nothing to go on: dimensions the camera did
 * not report, a frame already at the target, or any degenerate value. A skipped crop leaves a
 * 4:3 photograph, which is the shape this app saved until now — the safe degradation.
 */
export function sixteenNineCrop(
  width: number,
  height: number
): { originX: number; originY: number; width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  const long = Math.max(width, height);
  const short = Math.min(width, height);

  const targetShort = Math.round(long / TARGET_RATIO);

  // Already at or narrower than 16:9 — a further crop would be inventing a shape rather than
  // finding one. Sub-pixel differences are not worth a resample either.
  if (targetShort >= short - 1) return null;

  const trimmed = short - targetShort;
  const offset = Math.round(trimmed / 2);

  // Back onto the axis it came from: the short edge is the one being cut.
  return width < height
    ? { originX: offset, originY: 0, width: targetShort, height: long }
    : { originX: 0, originY: offset, width: long, height: targetShort };
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
 *
 * ## Why expo-crypto and not `globalThis.crypto`
 *
 * There is no Web Crypto in this runtime. Hermes does not provide it, and Expo's winter
 * polyfills cover `fetch`, `FormData`, `TextDecoder` and `URL` but deliberately not
 * `crypto` — so `globalThis.crypto` is `undefined`, and the previous version of this
 * function died on `Cannot read property 'getRandomValues' of undefined` at every single
 * capture. It was written as a defensive fallback for a global that never exists here.
 *
 * `expo-crypto` is backed by the platform's own CSPRNG (SecRandomCopyBytes on iOS,
 * SecureRandom on Android) and ships inside Expo Go, so it needs no native rebuild.
 */
function randomId(): string {
  return Crypto.randomUUID();
}
