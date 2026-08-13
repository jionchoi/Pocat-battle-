#!/usr/bin/env node

/**
 * Checks an uploaded capture for the two things that cannot be verified from source.
 *
 *   1. EXIF GPS. The bucket is public, so if the phone's location tags survived the upload
 *      then every photograph carries the exact coordinates of wherever it was taken, and
 *      anyone holding the URL can read them. That defeats the map toggle, the coarsened
 *      pins and the whole location story in one step, because none of those touch the file
 *      itself.
 *
 *   2. Cache-Control. Deleting a photo removes the row and the object, but a cached copy at
 *      the edge keeps answering until it expires. The upload asks for 300s; this reports
 *      what the CDN actually says, which is the number that decides how long "deleted"
 *      takes to become true.
 *
 * No dependencies and no exiftool. It reads the JPEG's own segment structure, which is a
 * few dozen lines and removes any question of whether the tool was installed correctly.
 *
 * Usage:
 *   node scripts/check-photo-privacy.mjs <public-url-or-local-path>
 *
 * Get a URL by taking one photo on a device and copying `imageUrl` off the capture
 * response, or from `storage_path` in the photos table.
 */

const target = process.argv[2];

if (!target) {
  console.error('Usage: node scripts/check-photo-privacy.mjs <url-or-path>');
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

let bytes;
let headers = null;

if (/^https?:\/\//.test(target)) {
  const response = await fetch(target);

  if (!response.ok) {
    console.error(`✗ ${response.status} fetching that URL.`);
    process.exit(1);
  }

  headers = response.headers;
  bytes = Buffer.from(await response.arrayBuffer());
} else {
  const { readFile } = await import('node:fs/promises');
  bytes = await readFile(target);
}

console.log(`Read ${bytes.length.toLocaleString()} bytes.\n`);

/* -------------------------------------------------------------------------- */
/* 1. EXIF                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Walks the JPEG's marker segments looking for an APP1 block that starts with `Exif\0\0`.
 *
 * Every segment after the start-of-image is `FF <marker> <2-byte length>` followed by that
 * many bytes, so the file can be stepped through without decoding a single pixel. The walk
 * stops at start-of-scan, since everything past it is entropy-coded image data rather than
 * metadata.
 */
function findExifSegment(buf) {
  if (buf.readUInt16BE(0) !== 0xffd8) return { jpeg: false };

  let offset = 2;
  const markers = [];

  while (offset < buf.length - 4) {
    if (buf[offset] !== 0xff) break;

    const marker = buf[offset + 1];

    // Start of scan — image data from here on.
    if (marker === 0xda) break;

    const length = buf.readUInt16BE(offset + 2);
    markers.push('0x' + marker.toString(16).toUpperCase());

    if (marker === 0xe1) {
      const header = buf.subarray(offset + 4, offset + 10).toString('latin1');

      if (header === 'Exif\0\0') {
        return { jpeg: true, markers, exif: buf.subarray(offset + 10, offset + 2 + length) };
      }
    }

    offset += 2 + length;
  }

  return { jpeg: true, markers, exif: null };
}

/**
 * Looks for the GPS IFD pointer in IFD0.
 *
 * Tag 0x8825 is the entry whose value is the offset of the GPS block. If it is not in IFD0
 * there are no GPS tags in the file — the coordinates cannot be anywhere else.
 */
function hasGpsPointer(exif) {
  const endian = exif.subarray(0, 2).toString('latin1');
  if (endian !== 'II' && endian !== 'MM') return null;

  const big = endian === 'MM';
  const u16 = (at) => (big ? exif.readUInt16BE(at) : exif.readUInt16LE(at));
  const u32 = (at) => (big ? exif.readUInt32BE(at) : exif.readUInt32LE(at));

  const ifd0 = u32(4);
  if (ifd0 + 2 > exif.length) return null;

  const count = u16(ifd0);
  const tags = [];

  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > exif.length) break;
    tags.push(u16(entry));
  }

  return { gps: tags.includes(0x8825), tagCount: tags.length };
}

const found = findExifSegment(bytes);

console.log('── EXIF ──');

if (!found.jpeg) {
  console.log('? Not a JPEG. This check only understands JPEG.');
} else if (!found.exif) {
  console.log('✓ No EXIF block at all. GPS coordinates cannot be present.');
  console.log(`  Segments present: ${found.markers.join(', ') || 'none'}`);
} else {
  const gps = hasGpsPointer(found.exif);

  if (gps === null) {
    console.log('? An EXIF block exists but could not be parsed. Inspect it by hand.');
  } else if (gps.gps) {
    console.log('✗ GPS TAGS PRESENT. Every uploaded photo is publishing its exact location.');
    console.log('  The re-encode is not stripping them. Fix before any real user data exists.');
  } else {
    console.log(`✓ EXIF present (${gps.tagCount} tags in IFD0) but no GPS block.`);
    console.log('  Location is not travelling in the file.');
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Caching                                                                 */
/* -------------------------------------------------------------------------- */

if (headers) {
  console.log('\n── Caching ──');

  const cacheControl = headers.get('cache-control');
  console.log(`cache-control: ${cacheControl ?? '(none)'}`);
  console.log(`age:           ${headers.get('age') ?? '(none)'}`);

  const maxAge = cacheControl?.match(/max-age=(\d+)/)?.[1];

  if (maxAge === undefined) {
    console.log('? No max-age. The edge is deciding on its own.');
  } else if (Number(maxAge) > 900) {
    console.log(
      `✗ ${maxAge}s is long enough that a deleted photo stays fetchable for ${Math.round(
        Number(maxAge) / 60
      )} minutes.`
    );
  } else {
    console.log(`✓ ${maxAge}s — a deleted photo stops being served within that.`);
  }

  console.log('\nTo check deletion for real: DELETE the photo, then run this again on the');
  console.log('same URL. A 400 or 404 means it is gone; a 200 means the edge still holds it.');
}
