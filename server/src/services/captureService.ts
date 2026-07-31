import { prisma } from '../db/client';
import { errors } from '../errors';
import { ALBUM_CONFIG, CAPTURE_CONFIG, XP } from '../game/rules';
import { generateCaptions } from '../integrations/caption';
import { store } from '../redis';
import { analyzePhoto } from '../integrations/vision';
import { deleteStoredPhoto, uploadCatPhoto } from '../integrations/storage';
import { logger } from '../logger';
import { identityKey, matchCat } from './catMatcher';
import { readImageSignals } from './imageSignals';
import { recordSighting } from './mapService';
import { grantXp } from './progressionService';
import { detectCoat } from './rarityDetector';
import { scorePhoto } from './scoringEngine';

/**
 * The capture pipeline (README section 9.1, step 6).
 *
 * Order matters and is deliberate:
 *   1. Rate limit  — before spending money on a Vision call.
 *   2. Album quota — before doing work we would only have to throw away.
 *   3. Vision      — verification and every scoring signal, in one billed request.
 *   4. Reject      — spoof and no-cat checks, before anything is written or stored.
 *   5. Match       — decide which real cat this is, so rarity knows about first discovery.
 *   6. Score       — server-side, from signals the client cannot forge.
 *   7. Upload      — only once we know we are keeping the photo.
 *   8. Persist     — one transaction covering photo, cat, dex entry and XP.
 *
 * The client's detection confidence and framing time are accepted as advisory telemetry
 * only. Nothing the client sends can raise a score.
 */

export interface CaptureInput {
  userId: string;
  photoBase64: string;
  lat: number;
  lng: number;
  clientConfidence: number;
  framingHeldMs: number;
  autoCaptured: boolean;
  logSighting: boolean;
  shareToFeed: boolean;
}

export type CaptureOutcome =
  | {
      outcome: 'scored';
      photoId: string;
      catId: string;
      isNewCat: boolean;
      captionSuggestions: string[];
      xpAwarded: number;
      rankUp: { from: number; to: number; title: string } | null;
    }
  | { outcome: 'rejected'; reason: string; message: string };

export async function submitCapture(input: CaptureInput): Promise<CaptureOutcome> {
  await enforceSubmissionRateLimit(input.userId);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, proSubscriptionActive: true },
  });
  if (!user) throw errors.notFound('That account no longer exists.');

  if (!user.proSubscriptionActive) {
    const photoCount = await prisma.photo.count({ where: { ownerId: input.userId } });
    if (photoCount >= ALBUM_CONFIG.freePhotoLimit) {
      // A full album is not the player spending an attempt — nothing was scored and no
      // Vision call was made, so the slot goes back.
      await refundRateLimitSlot(input.userId);

      // Not an error either: the app turns this into the Pro upsell rather than a failure
      // toast, so the player is told what to do about it.
      return {
        outcome: 'rejected',
        reason: 'album-full',
        message: `Your album is full at ${ALBUM_CONFIG.freePhotoLimit} photos. Free up space or go Pro for unlimited storage.`,
      };
    }
  }

  const buffer = Buffer.from(input.photoBase64, 'base64');
  const imageSignals = readImageSignals(buffer);

  let vision;
  try {
    vision = await analyzePhoto(input.photoBase64);
  } catch (err) {
    logger.error({ err }, 'vision analysis failed');
    // A provider outage must not be a silent pass, and it must not cost the player a
    // rate-limit slot for a failure that was ours.
    await refundRateLimitSlot(input.userId);
    return {
      outcome: 'rejected',
      reason: 'vision-unavailable',
      message: 'We could not score that photo right now. Try again in a moment.',
    };
  }

  if (vision.likelySpoofed) {
    return {
      outcome: 'rejected',
      reason: 'spoofed-photo',
      message: 'That looks like a photo of a screen. Point the camera at a real cat.',
    };
  }

  if (!vision.isCat || vision.confidence < CAPTURE_CONFIG.serverMinConfidence) {
    return {
      outcome: 'rejected',
      reason: 'no-cat-detected',
      message: 'We could not find a cat in that photo. Try again in better light.',
    };
  }

  const coat = detectCoat(vision.labels);
  const match = await matchCat({ lat: input.lat, lng: input.lng, coatLabels: coat.coatLabels });

  const existingCat = match?.cat ?? null;
  const isFirstDiscovery = existingCat === null;

  const dexEntry = existingCat
    ? await prisma.catDexEntry.findUnique({
        where: { userId_catId: { userId: input.userId, catId: existingCat.id } },
      })
    : null;

  const score = scorePhoto({
    vision,
    image: imageSignals,
    lat: input.lat,
    lng: input.lng,
    capturedAt: new Date(),
    isFirstDiscovery,
    globalEncounterCount: existingCat?.globalEncounterCount ?? 0,
    playerEncounterCount: dexEntry?.encounterCount ?? 0,
  });

  const upload = await uploadCatPhoto({
    userId: input.userId,
    photoBase64: input.photoBase64,
  });

  const captions = await generateCaptions({
    pose: score.pose,
    badges: score.badges,
    tier: score.tier,
    total: score.total,
    breedGuess: score.breedGuess,
    catNickname: dexEntry?.nickname ?? existingCat?.defaultNickname ?? score.title,
    isNewCat: isFirstDiscovery,
    goldenHour: score.bonusReasons.some((r) => r.includes('Golden')),
    catCount: vision.catCount,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Resolve the cat first — the photo needs its id, and a new discovery has to be
      // created before anything can reference it.
      const cat = existingCat
        ? await tx.cat.update({
            where: { id: existingCat.id },
            data: {
              globalEncounterCount: { increment: 1 },
              lastSeenAt: new Date(),
            },
          })
        : await tx.cat.create({
            data: {
              identityKey: identityKey({
                lat: input.lat,
                lng: input.lng,
                coatLabels: coat.coatLabels,
              }),
              discoveredByUserId: input.userId,
              defaultNickname: score.title,
              breedGuess: score.breedGuess,
              coatLabels: coat.coatLabels,
              rarityScore: score.coatScore,
              firstSeenLat: input.lat,
              firstSeenLng: input.lng,
            },
          });

      const photo = await tx.photo.create({
        data: {
          ownerId: input.userId,
          catId: cat.id,
          imageUrl: upload.url,
          storagePath: upload.objectPath,
          composition: score.composition,
          poseRarity: score.poseRarity,
          catRarity: score.catRarity,
          bonus: score.bonus,
          total: score.total,
          tier: score.tier,
          pose: score.pose,
          badges: score.badges,
          capturedLat: input.lat,
          capturedLng: input.lng,
          sharedToFeed: input.shareToFeed,
          visionLabels: vision.labels.slice(0, 40),
        },
      });

      // Upsert the dex entry, promoting the best shot only when this one actually beats
      // it — a worse photo of the same cat must never replace the player's best.
      const beatsBest = !dexEntry || score.total > dexEntry.bestPhotoScore;

      const entry = await tx.catDexEntry.upsert({
        where: { userId_catId: { userId: input.userId, catId: cat.id } },
        create: {
          userId: input.userId,
          catId: cat.id,
          bestPhotoId: photo.id,
          bestPhotoScore: score.total,
          bestTier: score.tier,
          encounterCount: 1,
        },
        update: {
          encounterCount: { increment: 1 },
          lastSeenAt: new Date(),
          ...(beatsBest
            ? {
                bestPhotoId: photo.id,
                bestPhotoScore: score.total,
                bestTier: score.tier,
              }
            : {}),
        },
      });

      const xpAwarded =
        Math.round(score.total * XP.perPhotoScoreMultiplier) +
        (isFirstDiscovery ? XP.newCatDiscovery : 0);

      const xp = await grantXp(tx, {
        userId: input.userId,
        amount: xpAwarded,
        reason: isFirstDiscovery ? 'capture-new-cat' : 'capture',
        refId: photo.id,
        scoreDelta: score.total,
      });

      return { photo, cat, entry, xp, xpAwarded };
    });

    if (input.logSighting) {
      // A sighting is a side effect of the capture, not a precondition for it. A failure
      // here must never cost the player their photo, so it is fire-and-forget.
      recordSighting({
        userId: input.userId,
        lat: input.lat,
        lng: input.lng,
        photoUrl: upload.url,
      }).catch((err) => logger.error({ err }, 'sighting log failed'));
    }

    return {
      outcome: 'scored',
      photoId: result.photo.id,
      catId: result.cat.id,
      isNewCat: isFirstDiscovery,
      captionSuggestions: captions,
      xpAwarded: result.xpAwarded,
      rankUp: result.xp.rankUp,
    };
  } catch (err) {
    // The blob is already in storage but the row that would reference it does not exist.
    // Without this the bucket accumulates orphans that nothing will ever clean up.
    if (upload.objectPath) {
      deleteStoredPhoto(upload.objectPath).catch((cleanupErr) =>
        logger.error({ cleanupErr }, 'orphaned photo cleanup failed')
      );
    }
    throw err;
  }
}

/**
 * Submission throttle. Lives in Redis rather than Postgres because it is hot,
 * short-lived, and has to be shared across instances — a per-instance limit would be
 * multiplied by the instance count, which defeats the point.
 */
async function enforceSubmissionRateLimit(userId: string): Promise<void> {
  const count = await store.incrBy(`catsnap:capture:rate:${userId}`, 1, 3600);

  if (count > CAPTURE_CONFIG.submissionsPerHour) {
    throw errors.tooMany(
      'You have submitted a lot of photos this hour. Take a walk and come back shortly.'
    );
  }
}

async function refundRateLimitSlot(userId: string): Promise<void> {
  await store.incrBy(`catsnap:capture:rate:${userId}`, -1, 3600);
}
