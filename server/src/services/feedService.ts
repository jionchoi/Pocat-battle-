import type { Prisma, Reaction } from '@prisma/client';

import { prisma } from '../db/client';
import { errors } from '../errors';
import { COMMUNITY, XP } from '../game/rules';
import { logger } from '../logger';
import { notifyVoteReceived } from '../integrations/push';
import { store } from '../redis';
import { grantXp } from './progressionService';
import { applyReactionDelta } from './viralService';

/**
 * Community feed and reactions (README section 9.5).
 *
 * There is no downvote and never will be — the reaction set is laugh/love/wow only,
 * which keeps the tone positive by construction rather than by moderation. The feed is
 * opt-in: a photo appears only if its owner shared it.
 */

export interface FeedQuery {
  viewerId: string;
  /** Restrict to photos by the viewer's friends. */
  friendsOnly?: boolean;
  cursor?: string;
  limit: number;
}

/* -------------------------------------------------------------------------- */
/* Impressions and ranking                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Both used to live here, and both now live in `viralService`.
 *
 * The old implementations were correct and unaffordable. `recordImpressions` wrote a row
 * per (photo, viewer) and then recounted the photo from its join tables — roughly seventy
 * queries for one scroll batch, on the highest-frequency action in the product. It is now
 * one pipelined Redis round trip, reconciled to Postgres by a job.
 *
 * The uniqueness that the `PhotoView` table provided is now a HyperLogLog. That is a real
 * trade and worth naming: unique viewers become accurate to ~0.8% rather than exactly
 * right. It buys a fixed 12KB per photo instead of unbounded row growth, and the number
 * in question is the denominator of a ratio, not anything a person is paid on.
 *
 * `PhotoView` is kept in the schema for audit and for exact recounts of individual photos
 * during moderation, but nothing writes to it on the request path any more.
 */

export async function listFeed(query: FeedQuery) {
  const where: Prisma.PhotoWhereInput = { sharedToFeed: true };

  if (query.friendsOnly) {
    const friendIds = await friendIdsFor(query.viewerId);
    // An empty friends list must return nothing, not everything — without this the
    // `in: []` would be dropped and the filter would silently disappear.
    where.ownerId = { in: friendIds.length > 0 ? friendIds : ['__none__'] };
  }

  const include = {
    cat: true,
    owner: {
      select: { id: true, username: true, avatarUrl: true, photographerRank: true },
    },
    votes: { where: { voterId: query.viewerId } },
  } satisfies Prisma.PhotoInclude;

  const rows = await prisma.photo.findMany({
    where,
    // Newest-first, deliberately. No engagement ranking in the feed itself: ordering by
    // community score would create a rich-get-richer loop where the photos that already
    // won get all the remaining views, which is exactly what the ratio is designed to
    // avoid. The score decides standing; the feed decides exposure, and exposure stays
    // roughly equal.
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include,
  });

  const photos = rows.slice(0, query.limit);
  const nextCursor =
    rows.length > query.limit ? photos[photos.length - 1]?.id ?? null : null;

  // Featured photos ride along on the first page only (README-adjacent: cold start).
  // A new app has no organic voting volume, so a light curation pass seeds the feed
  // until it is self-sustaining. Excluded from the cursor so paging stays stable.
  const featured =
    query.cursor || query.friendsOnly
      ? []
      : await prisma.photo.findMany({
          where: {
            sharedToFeed: true,
            featured: true,
            featuredAt: {
              gte: new Date(
                Date.now() - COMMUNITY.featuredBoostDays * 24 * 3600 * 1000
              ),
            },
            id: { notIn: photos.map((p) => p.id) },
          },
          orderBy: { featuredAt: 'desc' },
          take: 3,
          include,
        });

  return { photos: [...featured, ...photos], nextCursor };
}

/**
 * Records or changes a reaction.
 *
 * Tapping a second reaction *replaces* the first rather than adding to it, and tapping
 * the same one again clears it. The `Vote` row is the source of truth for that rule and
 * stays in Postgres, because uniqueness per (photo, voter) and the daily ceiling are both
 * correctness properties that a cache must not own.
 *
 * ## What is deliberately *not* in the transaction any more
 *
 * The per-reaction tallies on `Photo` used to be incremented here, in the same transaction
 * as the vote. That is the textbook hot-row problem: a photo going viral is by definition
 * one row that thousands of concurrent transactions all want to write, and every one of
 * them serialises behind the last. The photo that most needs to be fast is the one that
 * locks hardest — throughput collapses exactly at the moment of success.
 *
 * Counters now go to Redis (`HINCRBY`, no cross-request contention) and reach the row
 * through the flush job. The consequence is that `Photo.laughCount` trails by up to one
 * flush interval, which is why every read path layers the live counters over the row
 * rather than trusting it.
 */
export async function react(params: {
  photoId: string;
  voterId: string;
  reaction: Reaction;
}): Promise<{
  reactions: Record<Reaction, number>;
  myReaction: Reaction | null;
  communityScore: number;
  viewCount: number;
}> {
  const photo = await prisma.photo.findUnique({
    where: { id: params.photoId },
    select: {
      id: true,
      ownerId: true,
      sharedToFeed: true,
      capturedAt: true,
      laughCount: true,
      loveCount: true,
      wowCount: true,
      viewCount: true,
    },
  });

  if (!photo) throw errors.notFound('That photo no longer exists.');
  if (!photo.sharedToFeed) throw errors.forbidden('That photo is not shared.');
  if (photo.ownerId === params.voterId) {
    throw errors.badRequest('You cannot react to your own photo.');
  }

  await enforceDailyVoteLimit(params.voterId);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.vote.findUnique({
      where: { photoId_voterId: { photoId: params.photoId, voterId: params.voterId } },
    });

    let myReaction: Reaction | null = params.reaction;
    const deltas: Partial<Record<Reaction, number>> = {};

    if (!existing) {
      await tx.vote.create({
        data: {
          photoId: params.photoId,
          voterId: params.voterId,
          reaction: params.reaction,
        },
      });
      await tx.user.update({
        where: { id: photo.ownerId },
        data: { votesReceived: { increment: 1 } },
      });
      deltas[params.reaction] = 1;
    } else if (existing.reaction === params.reaction) {
      // Same reaction again — treat it as an undo.
      await tx.vote.delete({ where: { id: existing.id } });
      // The owner keeps the XP. Clawing it back would let anyone knock a rival down a
      // rank by voting and immediately un-voting.
      await tx.user.update({
        where: { id: photo.ownerId },
        data: { votesReceived: { decrement: 1 } },
      });
      deltas[params.reaction] = -1;
      myReaction = null;
    } else {
      await tx.vote.update({
        where: { id: existing.id },
        data: { reaction: params.reaction },
      });
      // The vote total is unchanged — one player still counts once — but which bucket it
      // sits in moves.
      deltas[existing.reaction] = -1;
      deltas[params.reaction] = 1;
    }

    return { myReaction, deltas, isNew: !existing };
  });

  // Outside the transaction and outside Postgres: counters, community score and the
  // photo's position in every ranking window, in one place.
  const live = await applyReactionDelta({
    photoId: params.photoId,
    capturedAt: photo.capturedAt,
    deltas: result.deltas,
    fallback: {
      laugh: photo.laughCount,
      love: photo.loveCount,
      wow: photo.wowCount,
      views: photo.viewCount,
    },
  });

  if (result.isNew) {
    // This is the dominant term in Photographer Rank. It is capped per photo per day so
    // a reciprocity ring hammering one shot cannot farm someone up the ranks.
    grantReactionXp(photo.ownerId, params.photoId).catch((err) =>
      logger.error({ err }, 'reaction xp grant failed')
    );

    notifyVoteReceived({
      userId: photo.ownerId,
      reaction: params.reaction,
      photoId: params.photoId,
    }).catch((err) => logger.error({ err }, 'vote notification failed'));
  }

  return {
    reactions: { laugh: live.laugh, love: live.love, wow: live.wow },
    myReaction: result.myReaction,
    communityScore: live.communityScore,
    viewCount: live.views,
  };
}

/**
 * Daily vote ceiling.
 *
 * The anti-brigading control. Reciprocity rings and vote-trading both need volume, so a
 * per-day cap makes coordinated voting expensive while leaving normal browsing
 * untouched — 30 is well past what anyone reaches scrolling a feed honestly.
 *
 * Redis rather than Postgres because it is hot, short-lived and has to be shared across
 * instances: a per-instance counter would multiply the real allowance by the fleet size,
 * which is precisely the limit being enforced.
 */
async function enforceDailyVoteLimit(voterId: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const count = await store.incrBy(`catsnap:votes:${day}:${voterId}`, 1, 86_400);

  if (count > COMMUNITY.maxVotesPerDay) {
    throw errors.tooMany(
      `You have used all ${COMMUNITY.maxVotesPerDay} of today's reactions. They reset tomorrow.`
    );
  }
}

function counterFor(reaction: Reaction): 'laughCount' | 'loveCount' | 'wowCount' {
  if (reaction === 'laugh') return 'laughCount';
  if (reaction === 'love') return 'loveCount';
  return 'wowCount';
}

async function grantReactionXp(ownerId: string, photoId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const granted = await prisma.xpLedgerEntry.aggregate({
    where: { userId: ownerId, reason: 'reaction-received', refId: photoId, createdAt: { gte: since } },
    _sum: { delta: true },
  });

  if ((granted._sum.delta ?? 0) >= XP.maxReactionXpPerPhotoPerDay) return;

  await prisma.$transaction(async (tx) => {
    await grantXp(tx, {
      userId: ownerId,
      amount: XP.perReactionReceived,
      reason: 'reaction-received',
      refId: photoId,
    });
  });
}

export async function friendIdsFor(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      accepted: true,
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });

  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}
