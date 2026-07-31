import { FOCUS, clamp, ramp } from '../game/rules';

/**
 * Signals read from the image bytes themselves, with no decode and no extra dependency.
 *
 * Focus is the one composition input Google Vision does not give us. A full sharpness
 * measure (Laplacian variance) needs a decoded bitmap, which means pulling in sharp or
 * jimp — a native build or a slow pure-JS decode on the hot submit path, for one number
 * that is 30% of one of three score components.
 *
 * Instead we use compressed density: bytes per pixel. JPEG spends its bits on
 * high-frequency detail, which is exactly what blur destroys, so a blurred photo at a
 * given resolution and quality compresses markedly smaller than a sharp one. It cannot
 * rank two sharp photos against each other, but it separates "clearly blurry" from
 * "sharp" reliably, which is the distinction the score actually needs.
 *
 * Known limitation: the client controls JPEG quality, so a player could upload at a
 * higher quality to inflate density. The app pins quality (see CAPTURE_CONFIG mirror in
 * the client) and the effect is bounded — focus can move the total by at most a few
 * points, and never enough to change tier on its own.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageSignals {
  byteLength: number;
  dimensions: ImageDimensions | null;
  bytesPerPixel: number | null;
  /** 0-100. Falls back to a neutral score when dimensions could not be read. */
  focusScore: number;
}

export function readImageSignals(buffer: Buffer): ImageSignals {
  const dimensions = readJpegDimensions(buffer) ?? readPngDimensions(buffer);

  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return {
      byteLength: buffer.byteLength,
      dimensions: null,
      bytesPerPixel: null,
      focusScore: FOCUS.unknownScore,
    };
  }

  const pixels = dimensions.width * dimensions.height;
  const bytesPerPixel = buffer.byteLength / pixels;

  return {
    byteLength: buffer.byteLength,
    dimensions,
    bytesPerPixel,
    focusScore: Math.round(ramp(bytesPerPixel, FOCUS.blurryBpp, FOCUS.sharpBpp)),
  };
}

/**
 * Walks JPEG segment headers to the Start-Of-Frame marker, which carries the real
 * dimensions. Reading the EXIF thumbnail's size or trusting a client-declared width would
 * both be wrong; SOF is the decoder's own answer.
 */
export function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;

  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];

    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    // Start of scan — compressed data follows, so no SOF is coming.
    if (marker === 0xda) return null;

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;

    // SOF0-SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      if (offset + 9 >= buffer.length) return null;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

/** PNG keeps width and height at a fixed offset in the IHDR chunk. */
export function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Local hour at a coordinate, estimated from longitude rather than a timezone database.
 *
 * The golden-hour bonus needs to know roughly what time it was where the photo was taken.
 * Pulling in a full tz lookup (and keeping its data current) is disproportionate for a
 * six-point bonus, and longitude gives the solar hour directly — which is arguably more
 * correct here than civil time, since the sun is what makes golden hour.
 */
export function solarHourAt(lng: number, at: Date = new Date()): number {
  const utcHours = at.getUTCHours() + at.getUTCMinutes() / 60;
  const offset = lng / 15;
  return ((utcHours + offset) % 24 + 24) % 24;
}

export function clampScore(value: number): number {
  return clamp(Math.round(value), 0, 100);
}
