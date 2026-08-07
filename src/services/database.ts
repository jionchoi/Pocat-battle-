import * as SQLite from 'expo-sqlite';

import type { Photo } from '../models';

/**
 * Offline-first local cache for the photo album (README section 10).
 *
 * SQLite rather than AsyncStorage: the Album screen filters and searches over
 * potentially hundreds of photos, and doing that by deserialising one big JSON blob on
 * every keystroke is exactly the pattern that makes a list feel slow.
 *
 * This is a cache, not a source of truth. The server owns the data; anything here can be
 * discarded and refetched. Image bytes are not cached here — expo-image maintains its
 * own disk cache keyed on the CDN URL, which is the right layer for that.
 */

let database: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  database = await SQLite.openDatabaseAsync('catframe.db');

  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      cat_id TEXT NOT NULL,
      cat_nickname TEXT NOT NULL,
      tier TEXT NOT NULL,
      total INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_photos_owner ON photos(owner_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_score ON photos(owner_id, total DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_tier ON photos(owner_id, tier);
    CREATE INDEX IF NOT EXISTS idx_photos_cat ON photos(owner_id, cat_id);
    CREATE INDEX IF NOT EXISTS idx_photos_nickname ON photos(owner_id, cat_nickname);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  return database;
}

export interface LocalPhotoQuery {
  ownerId: string;
  tier?: string;
  catId?: string;
  search?: string;
  sort?: 'recent' | 'score';
}

/**
 * Filtering happens in SQL rather than in JavaScript, so a large album stays responsive
 * while the player types.
 */
export async function readPhotos(query: LocalPhotoQuery): Promise<Photo[]> {
  const handle = await db();

  const clauses = ['owner_id = ?'];
  const params: (string | number)[] = [query.ownerId];

  if (query.tier) {
    clauses.push('tier = ?');
    params.push(query.tier);
  }
  if (query.catId) {
    clauses.push('cat_id = ?');
    params.push(query.catId);
  }
  if (query.search) {
    clauses.push('cat_nickname LIKE ? COLLATE NOCASE');
    params.push(`%${query.search}%`);
  }

  const order =
    query.sort === 'score' ? 'total DESC, captured_at DESC' : 'captured_at DESC';

  const rows = await handle.getAllAsync<{ payload: string }>(
    `SELECT payload FROM photos WHERE ${clauses.join(' AND ')} ORDER BY ${order}`,
    params
  );

  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payload) as Photo;
      } catch {
        // A payload written by an older app version may no longer parse. Dropping the
        // row is correct — it is a cache, and the server copy is authoritative.
        return null;
      }
    })
    .filter((photo): photo is Photo => photo !== null);
}

export async function writePhotos(photos: Photo[]): Promise<void> {
  if (photos.length === 0) return;

  const handle = await db();
  const now = Date.now();

  // One transaction for the whole batch. Row-at-a-time inserts on a 200-photo sync are
  // hundreds of separate disk commits.
  await handle.withTransactionAsync(async () => {
    for (const photo of photos) {
      await handle.runAsync(
        `INSERT INTO photos
           (id, owner_id, payload, cat_id, cat_nickname, tier, total, captured_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           cat_id = excluded.cat_id,
           cat_nickname = excluded.cat_nickname,
           tier = excluded.tier,
           total = excluded.total,
           captured_at = excluded.captured_at,
           synced_at = excluded.synced_at`,
        [
          photo.id,
          photo.ownerId,
          JSON.stringify(photo),
          photo.catId,
          photo.catNickname,
          photo.tier,
          photo.scores.total,
          photo.capturedAt,
          now,
        ]
      );
    }
  });
}

export async function writePhoto(photo: Photo): Promise<void> {
  await writePhotos([photo]);
}

export async function deletePhoto(photoId: string): Promise<void> {
  const handle = await db();
  await handle.runAsync('DELETE FROM photos WHERE id = ?', [photoId]);
}

/**
 * Replace the cached album for one owner.
 *
 * Deleting ids the server no longer returned is the part that matters — without it, a
 * photo deleted on another device lingers in this device's cache forever.
 */
export async function replacePhotos(ownerId: string, photos: Photo[]): Promise<void> {
  const handle = await db();

  await handle.withTransactionAsync(async () => {
    await handle.runAsync('DELETE FROM photos WHERE owner_id = ?', [ownerId]);
  });

  await writePhotos(photos);
}

export async function countPhotos(ownerId: string): Promise<number> {
  const handle = await db();
  const row = await handle.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM photos WHERE owner_id = ?',
    [ownerId]
  );
  return row?.count ?? 0;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const handle = await db();
  await handle.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const handle = await db();
  const row = await handle.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

/** Called on sign-out. Leaving another account's album cached on the device is wrong. */
export async function clearLocalData(): Promise<void> {
  const handle = await db();
  await handle.execAsync('DELETE FROM photos; DELETE FROM meta;');
}
