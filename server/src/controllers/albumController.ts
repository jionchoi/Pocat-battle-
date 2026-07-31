import type { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/client';
import { authOf } from '../middleware/auth';
import { serializeCat, serializePhoto } from '../serializers/photo';
import {
  deletePhoto,
  getCatProfile,
  getPhotoForOwner,
  listAlbum,
  listCatDex,
  renameCat,
  updatePhoto,
} from '../services/albumService';

/**
 * Photo Album, Photo Detail and Cat Dex (README sections 5.3 and 11).
 */

export const albumQuerySchema = z.object({
  tier: z.enum(['Common', 'Rare', 'Epic', 'Legendary']).optional(),
  search: z.string().max(60).optional(),
  catId: z.string().optional(),
  sort: z.enum(['recent', 'score']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});

export const patchPhotoSchema = z.object({
  caption: z.string().max(140).optional(),
  sharedToFeed: z.boolean().optional(),
  showcased: z.boolean().optional(),
});

export const patchCatSchema = z.object({
  nickname: z.string().max(30).optional(),
  bio: z.string().max(200).optional(),
});

export async function album(req: Request, res: Response) {
  const { userId } = authOf(req);
  const query = req.query as z.infer<typeof albumQuerySchema>;

  const { photos, nextCursor, dexEntries } = await listAlbum({
    ownerId: userId,
    tier: query.tier,
    search: query.search,
    catId: query.catId,
    sort: query.sort,
    cursor: query.cursor,
    limit: query.limit ?? 30,
  });

  res.json({
    photos: photos.map((photo) =>
      serializePhoto(photo, {
        viewerId: userId,
        dexEntry: dexEntries.get(photo.catId),
        cat: photo.cat,
      })
    ),
    nextCursor,
  });
}

export async function photoDetail(req: Request, res: Response) {
  const { userId } = authOf(req);
  const photo = await getPhotoForOwner(req.params.id, userId);

  const entry = await prisma.catDexEntry.findUnique({
    where: { userId_catId: { userId, catId: photo.catId } },
  });

  res.json({
    photo: serializePhoto(photo, { viewerId: userId, dexEntry: entry, cat: photo.cat }),
  });
}

export async function patchPhoto(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof patchPhotoSchema>;

  const photo = await updatePhoto({
    photoId: req.params.id,
    ownerId: userId,
    caption: body.caption,
    sharedToFeed: body.sharedToFeed,
    showcased: body.showcased,
  });

  const entry = await prisma.catDexEntry.findUnique({
    where: { userId_catId: { userId, catId: photo.catId } },
  });

  res.json({
    photo: serializePhoto(photo, { viewerId: userId, dexEntry: entry, cat: photo.cat }),
  });
}

export async function removePhoto(req: Request, res: Response) {
  await deletePhoto(req.params.id, authOf(req).userId);
  res.status(204).send();
}

/* --------------------------------- cat dex -------------------------------- */

export async function catdex(req: Request, res: Response) {
  const { userId } = authOf(req);
  const rows = await listCatDex(userId);

  res.json({
    cats: rows.map((row) =>
      serializeCat(row.cat, row.entry, userId, {
        bestPhotoUrl: row.bestPhotoUrl,
        photoCount: row.photoCount,
      })
    ),
  });
}

export async function catProfile(req: Request, res: Response) {
  const { userId } = authOf(req);
  const result = await getCatProfile(userId, req.params.catId);

  res.json({
    cat: serializeCat(result.entry.cat, result.entry.entry, userId, {
      bestPhotoUrl: result.entry.bestPhotoUrl,
      photoCount: result.entry.photoCount,
    }),
    photos: result.photos.map((photo) =>
      serializePhoto(photo, {
        viewerId: userId,
        dexEntry: result.entry.entry,
        cat: photo.cat,
      })
    ),
    encounterLocations: result.encounterLocations,
    firstEncounterAt: result.firstEncounterAt.toISOString(),
  });
}

export async function patchCat(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof patchCatSchema>;

  const entry = await renameCat({
    userId,
    catId: req.params.catId,
    nickname: body.nickname,
    bio: body.bio,
  });

  const [bestPhoto, photoCount] = await Promise.all([
    entry.bestPhotoId
      ? prisma.photo.findUnique({
          where: { id: entry.bestPhotoId },
          select: { imageUrl: true },
        })
      : null,
    prisma.photo.count({ where: { ownerId: userId, catId: entry.catId } }),
  ]);

  res.json({
    cat: serializeCat(entry.cat, entry, userId, {
      bestPhotoUrl: bestPhoto?.imageUrl ?? '',
      photoCount,
    }),
  });
}
