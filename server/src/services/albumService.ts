import type { CatDexEntry, Prisma, Rarity } from '@prisma/client';

import { prisma } from '../db/client';
import { errors } from '../errors';
import { ALBUM_CONFIG } from '../game/rules';
import { deleteStoredPhoto } from '../integrations/storage';
import { logger } from '../logger';
import { rerank, unrank } from './viralService';

/**
 * Photo Album and Cat Dex reads (README sections 5.3 and 9.3).
 *
 * Every query here is scoped to the signed-in player. There is no "all photos" path,
 * because the album is private by construction — a photo reaches other players only
 * through the opt-in feed or a challenge entry.
 */

export type AlbumSort = 'recent' | 'score';

export interface AlbumQuery {
  ownerId: string;
  tier?: Rarity;
  /** Free-text match against the player's nickname for the cat. */
  search?: string;
  catId?: string;
  sort?: AlbumSort;
  cursor?: string;
  limit: number;
}

export async function listAlbum(query: AlbumQuery) {
  const where: Prisma.PhotoWhereInput = { ownerId: query.ownerId };

  if (query.tier) where.tier = query.tier;
  if (query.catId) where.catId = query.catId;

  if (query.search) {
    // Search is by cat name, which lives on the dex entry (player's own name) or the
    // cat (the discoverer's default) — so both have to be matched.
    const term = query.search.trim();
    where.cat = {
      OR: [
        { defaultNickname: { contains: term, mode: 'insensitive' } },
        {
          dexEntries: {
            some: {
              userId: query.ownerId,
              nickname: { contains: term, mode: 'insensitive' },
            },
          },
        },
      ],
    };
  }

  const orderBy: Prisma.PhotoOrderByWithRelationInput[] =
    query.sort === 'score'
      ? [{ total: 'desc' }, { id: 'desc' }]
      : [{ capturedAt: 'desc' }, { id: 'desc' }];

  const rows = await prisma.photo.findMany({
    where,
    orderBy,
    // Fetch one extra to find out whether another page exists, without a second count.
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { cat: true, votes: { where: { voterId: query.ownerId } } },
  });

  const page = rows.slice(0, query.limit);
  const nextCursor = rows.length > query.limit ? page[page.length - 1]?.id ?? null : null;

  const dexEntries = await dexEntriesFor(query.ownerId, page.map((p) => p.catId));

  return { photos: page, nextCursor, dexEntries };
}

/** Map of catId → this player's dex entry, for denormalising nicknames onto photos. */
export async function dexEntriesFor(
  userId: string,
  catIds: string[]
): Promise<Map<string, CatDexEntry>> {
  if (catIds.length === 0) return new Map();

  const entries = await prisma.catDexEntry.findMany({
    where: { userId, catId: { in: [...new Set(catIds)] } },
  });

  return new Map(entries.map((e) => [e.catId, e]));
}

export async function getPhotoForOwner(photoId: string, ownerId: string) {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    include: { cat: true, votes: { where: { voterId: ownerId } } },
  });

  if (!photo) throw errors.notFound('That photo no longer exists.');
  if (photo.ownerId !== ownerId) throw errors.forbidden('That photo is not yours.');

  return photo;
}

export async function updatePhoto(params: {
  photoId: string;
  ownerId: string;
  caption?: string;
  sharedToFeed?: boolean;
  showcased?: boolean;
}) {
  const photo = await getPhotoForOwner(params.photoId, params.ownerId);

  if (params.showcased === true) {
    const showcasedCount = await prisma.photo.count({
      where: { ownerId: params.ownerId, showcased: true, id: { not: photo.id } },
    });
    if (showcasedCount >= ALBUM_CONFIG.showcaseLimit) {
      throw errors.badRequest(
        `You can showcase up to ${ALBUM_CONFIG.showcaseLimit} photos. Remove one first.`
      );
    }
  }

  const updated = await prisma.photo.update({
    where: { id: photo.id },
    data: {
      ...(params.caption !== undefined ? { caption: params.caption.trim() || null } : {}),
      ...(params.sharedToFeed !== undefined ? { sharedToFeed: params.sharedToFeed } : {}),
      ...(params.showcased !== undefined ? { showcased: params.showcased } : {}),
    },
    include: { cat: true, votes: { where: { voterId: params.ownerId } } },
  });

  // Sharing is what puts a photo in front of the ranking, and un-sharing has to take it
  // straight back out — a cached page rebuilt from a stale ZSET would keep serving a photo
  // its owner just made private, which is the one cache-staleness bug that is not
  // cosmetic.
  if (params.sharedToFeed !== undefined) {
    if (params.sharedToFeed) {
      await rerank({
        photoId: updated.id,
        capturedAt: updated.capturedAt,
        reactions: updated.laughCount + updated.loveCount + updated.wowCount,
        views: updated.viewCount,
        communityScore: updated.communityScore,
      });
    } else {
      await unrank(updated.id);
    }
  }

  return updated;
}

/**
 * Deletes a photo, its blob, and repairs the Cat Dex entry it may have been the best
 * shot for.
 *
 * The repair is the subtle part: deleting a player's best photo of a cat must promote
 * their next-best rather than leaving the dex pointing at a row that no longer exists.
 */
export async function deletePhoto(photoId: string, ownerId: string): Promise<void> {
  const photo = await getPhotoForOwner(photoId, ownerId);

  // Before the row goes, so a concurrent page rebuild cannot re-add it from a read that
  // raced the delete.
  await unrank(photo.id);

  await prisma.$transaction(async (tx) => {
    await tx.photo.delete({ where: { id: photo.id } });

    const entry = await tx.catDexEntry.findUnique({
      where: { userId_catId: { userId: ownerId, catId: photo.catId } },
    });
    if (!entry) return;

    const remaining = await tx.photo.findMany({
      where: { ownerId, catId: photo.catId },
      orderBy: { total: 'desc' },
      take: 1,
    });

    if (remaining.length === 0) {
      // No photos of this cat left, so the player no longer has it in their Dex. The
      // global Cat row stays — other players may still have it, and it holds the
      // identity used to re-match the animal later.
      await tx.catDexEntry.delete({ where: { id: entry.id } });
      return;
    }

    const best = remaining[0];

    await tx.catDexEntry.update({
      where: { id: entry.id },
      data: {
        encounterCount: Math.max(1, entry.encounterCount - 1),
        bestPhotoId: best.id,
        bestPhotoScore: best.total,
        bestTier: best.tier,
      },
    });
  });

  deleteStoredPhoto(photo.storagePath).catch((err) =>
    logger.error({ err, photoId }, 'photo blob delete failed')
  );
}

/* -------------------------------------------------------------------------- */
/* Cat Dex                                                                    */
/* -------------------------------------------------------------------------- */

export async function listCatDex(userId: string) {
  const entries = await prisma.catDexEntry.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
    include: { cat: true },
  });

  return hydrateDexEntries(userId, entries);
}

export async function getCatProfile(userId: string, catId: string) {
  const entry = await prisma.catDexEntry.findUnique({
    where: { userId_catId: { userId, catId } },
    include: { cat: true },
  });

  if (!entry) throw errors.notFound('You have not photographed that cat yet.');

  const photos = await prisma.photo.findMany({
    where: { ownerId: userId, catId },
    orderBy: { capturedAt: 'desc' },
    include: { cat: true, votes: { where: { voterId: userId } } },
  });

  const [hydrated] = await hydrateDexEntries(userId, [entry]);

  return {
    entry: hydrated,
    photos,
    // Distinct capture locations for the mini map. Deduped to whole-metre-ish cells so
    // twenty photos from the same doorstep do not stack twenty identical pins.
    encounterLocations: dedupeLocations(
      photos.map((p) => ({ lat: p.capturedLat, lng: p.capturedLng }))
    ),
    firstEncounterAt: entry.firstSeenAt,
  };
}

/** Attaches the best photo's URL and a per-cat photo count to each dex entry. */
async function hydrateDexEntries(
  userId: string,
  entries: (Prisma.CatDexEntryGetPayload<{ include: { cat: true } }>)[]
) {
  if (entries.length === 0) return [];

  const bestPhotoIds = entries
    .map((e) => e.bestPhotoId)
    .filter((id): id is string => id !== null);

  const [bestPhotos, counts] = await Promise.all([
    prisma.photo.findMany({
      where: { id: { in: bestPhotoIds } },
      select: { id: true, imageUrl: true },
    }),
    prisma.photo.groupBy({
      by: ['catId'],
      where: { ownerId: userId, catId: { in: entries.map((e) => e.catId) } },
      _count: { _all: true },
    }),
  ]);

  const urlById = new Map(bestPhotos.map((p) => [p.id, p.imageUrl]));
  const countByCat = new Map(counts.map((c) => [c.catId, c._count._all]));

  return entries.map((entry) => ({
    entry,
    cat: entry.cat,
    bestPhotoUrl: entry.bestPhotoId ? urlById.get(entry.bestPhotoId) ?? '' : '',
    photoCount: countByCat.get(entry.catId) ?? 0,
  }));
}

export async function renameCat(params: {
  userId: string;
  catId: string;
  nickname?: string;
  bio?: string;
}) {
  const entry = await prisma.catDexEntry.findUnique({
    where: { userId_catId: { userId: params.userId, catId: params.catId } },
  });

  if (!entry) throw errors.notFound('You have not photographed that cat yet.');

  return prisma.catDexEntry.update({
    where: { id: entry.id },
    data: {
      ...(params.nickname !== undefined
        ? { nickname: params.nickname.trim() || null }
        : {}),
      ...(params.bio !== undefined ? { bio: params.bio.trim() || null } : {}),
    },
    include: { cat: true },
  });
}

function dedupeLocations(points: { lat: number; lng: number }[]) {
  const seen = new Set<string>();
  const out: { lat: number; lng: number }[] = [];

  for (const point of points) {
    const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point);
  }

  return out;
}

/** Album usage, for the profile meter and the Pro upsell trigger. */
export async function albumUsage(userId: string, proActive: boolean) {
  const photoCount = await prisma.photo.count({ where: { ownerId: userId } });
  const limit = proActive ? null : ALBUM_CONFIG.freePhotoLimit;

  return {
    photoCount,
    photoLimit: limit,
    nearingLimit:
      limit !== null && photoCount >= Math.floor(limit * ALBUM_CONFIG.upsellThreshold),
  };
}
