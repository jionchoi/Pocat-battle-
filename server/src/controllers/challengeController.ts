import type { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../db/client';
import { authOf } from '../middleware/auth';
import {
  serializeChallenge,
  serializePhoto,
  serializePhotoWithAuthor,
} from '../serializers/photo';
import { dexEntriesFor } from '../services/albumService';
import {
  activeChallenges,
  challengeEntries,
  pastChallenges,
  submitToChallenge,
} from '../services/challengeService';

/**
 * Challenges Hub, submission and entries (README sections 5.4 and 11).
 */

export const submitSchema = z.object({
  photoId: z.string().min(1),
});

export async function active(req: Request, res: Response) {
  const { userId } = authOf(req);

  const [current, past] = await Promise.all([
    activeChallenges(userId),
    pastChallenges(userId),
  ]);

  // Past challenges show their winner inline so the "previous winners" rail on the hub
  // needs no follow-up request per challenge.
  const winningPhotoIds = past
    .map((row) => row.challenge.winningPhotoId)
    .filter((id): id is string => id !== null);

  const winners = await prisma.photo.findMany({
    where: { id: { in: winningPhotoIds } },
    include: {
      cat: true,
      owner: { select: { id: true, username: true, avatarUrl: true, photographerRank: true } },
      votes: { where: { voterId: userId } },
    },
  });

  const dexEntries = await dexEntriesFor(userId, winners.map((w) => w.catId));
  const winnerById = new Map(winners.map((w) => [w.id, w]));

  res.json({
    active: current.map((row) =>
      serializeChallenge(row.challenge, {
        submissionCount: row.submissionCount,
        mySubmissionPhotoId: row.mySubmissionPhotoId,
      })
    ),
    past: past.map((row) => {
      const winner = row.challenge.winningPhotoId
        ? winnerById.get(row.challenge.winningPhotoId)
        : undefined;

      return {
        ...serializeChallenge(row.challenge, {
          submissionCount: row.submissionCount,
          mySubmissionPhotoId: row.mySubmissionPhotoId,
        }),
        winningPhoto: winner
          ? serializePhotoWithAuthor(winner, {
              viewerId: userId,
              dexEntry: dexEntries.get(winner.catId),
              cat: winner.cat,
            })
          : undefined,
      };
    }),
  });
}

export async function submit(req: Request, res: Response) {
  const { userId } = authOf(req);
  const body = req.body as z.infer<typeof submitSchema>;

  const result = await submitToChallenge({
    userId,
    challengeId: req.params.id,
    photoId: body.photoId,
  });

  const entry = await prisma.catDexEntry.findUnique({
    where: { userId_catId: { userId, catId: result.photo.catId } },
  });

  res.json({
    photo: serializePhoto(result.photo, {
      viewerId: userId,
      dexEntry: entry,
      cat: result.photo.cat,
    }),
    alreadyEntered: result.alreadyEntered,
  });
}

export async function entries(req: Request, res: Response) {
  const { userId } = authOf(req);

  const rows = await challengeEntries(req.params.id, userId);
  const dexEntries = await dexEntriesFor(userId, rows.map((r) => r.catId));

  res.json({
    entries: rows.map((photo) =>
      serializePhotoWithAuthor(photo, {
        viewerId: userId,
        dexEntry: dexEntries.get(photo.catId),
        cat: photo.cat,
      })
    ),
  });
}

/**
 * Photos eligible to enter a challenge: the player's own album, best first, so the
 * submission screen opens on the shots they are most likely to pick.
 */
export async function eligiblePhotos(req: Request, res: Response) {
  const { userId } = authOf(req);

  const photos = await prisma.photo.findMany({
    where: { ownerId: userId },
    orderBy: { total: 'desc' },
    take: 60,
    include: { cat: true, votes: { where: { voterId: userId } } },
  });

  const dexEntries = await dexEntriesFor(userId, photos.map((p) => p.catId));

  res.json({
    photos: photos.map((photo) =>
      serializePhoto(photo, {
        viewerId: userId,
        dexEntry: dexEntries.get(photo.catId),
        cat: photo.cat,
      })
    ),
  });
}
