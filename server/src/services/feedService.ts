import type { Prisma, Reaction } from '@prisma/client';

import { prisma } from '../db/client';
import { errors } from '../errors';
import { COMMUNITY, XP, communityScore } from '../game/rules';
import { logger } from '../logger';
import { notifyVoteReceived } from '../integrations/push';
import { store } from '../redis';
import { grantXp } from './progressionService';

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
/* Impressions — the denominator of the engagement ratio                      */
/* -------------------------------------------------------------------------- */

/**
 * Records that a viewer actually saw these photos.
 *
 * Reported by the client from `onViewableItemsChanged`, not from the feed response —
 * a photo returned in a page the player scrolled straight past was never really seen,
 * and counting it would depress its ratio for no reason.
 *
 * Deduped by the `(photoId, viewerId)` unique constraint, so re-scrolling a feed cannot
 * inflate the denominator. `skipDuplicates` makes that a single round trip instead of a
 * read-then-write race.
 *
 * A viewer's own photos are excluded: looking at your own work is not reach, and
 * counting it would let anyone tank their own ratio by admiring their photo.
 */
export async function recordImpressions(params: {
  viewerId: string;
  photoIds: string[];
}): Promise<{ recorded: number }> {
  const ids = [...new Set(params.photoIds)].slice(0, 100);
  if (ids.length === 0) return { recorded: 0 };

  const photos = await prisma.photo.findMany({
    where: { id: { in: ids }, sharedToFeed: true, ownerId: { not: params.viewerId } },
    select: { id: true },
  });

  if (photos.length === 0) return { recorded: 0 };

  const created = await prisma.photoView.createMany({
    data: photos.map((photo) => ({ photoId: photo.id, viewerId: params.viewerId })),
    skipDuplicates: true,
  });

  if (created.count === 0) return { recorded: 0 };

  // Only the genuinely new views need their counters moved. Which ids were new is not
  // returned by createMany, so the affected photos are recounted from the source of
  // truth — correct by construction, and bounded by the page size.
  await Promise.all(photos.map((photo) => refreshCommunityScore(photo.id)));

  return { recorded: created.count };
}

/**
 * Recomputes `viewCount`, `voteCount` and `communityScore` for one photo from its rows.
 *
 * Derived from the join tables rather than incremented in place: the denormalised
 * counters exist for read speed, and recomputing them is what stops a lost increment
 * from permanently skewing someone's rank.
 */
export async function refreshCommunityScore(photoId: string): Promise<void> {
  const [views, votes] = await Promise.all([
    prisma.photoView.count({ where: { photoId } }),
    prisma.vote.count({ where: { photoId } }),
  ]);

  await prisma.photo.update({
    where: { id: photoId },
    data: {
      viewCount: views,
      communityScore: communityScore({ votes, views }),
    },
  });
}

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
 * the same one again clears it. The per-reaction counters on Photo are maintained here
 * in the same transaction as the Vote row, so the denormalised tallies cannot drift.
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
    select: { id: true, ownerId: true, sharedToFeed: true },
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

    if (!existing) {
      await tx.vote.create({
        data: {
          photoId: params.photoId,
          voterId: params.voterId,
          reaction: params.reaction,
        },
      });
      await tx.photo.update({
        where: { id: params.photoId },
        data: { voteCount: { increment: 1 }, [counterFor(params.reaction)]: { increment: 1 } },
      });
      await tx.user.update({
        where: { id: photo.ownerId },
        data: { votesReceived: { increment: 1 } },
      });
    } else if (existing.reaction === params.reaction) {
      // Same reaction again — treat it as an undo.
      await tx.vote.delete({ where: { id: existing.id } });
      await tx.photo.update({
        where: { id: params.photoId },
        data: { voteCount: { decrement: 1 }, [counterFor(params.reaction)]: { decrement: 1 } },
      });
      // The owner keeps the XP. Clawing it back would let anyone knock a rival down a
      // rank by voting and immediately un-voting.
      await tx.user.update({
        where: { id: photo.ownerId },
        data: { votesReceived: { decrement: 1 } },
      });
      myReaction = null;
    } else {
      await tx.vote.update({
        where: { id: existing.id },
        data: { reaction: params.reaction },
      });
      // voteCount is unchanged — one player still counts once.
      await tx.photo.update({
        where: { id: params.photoId },
        data: {
          [counterFor(existing.reaction)]: { decrement: 1 },
          [counterFor(params.reaction)]: { increment: 1 },
        },
      });
    }

    const updated = await tx.photo.findUniqueOrThrow({
      where: { id: params.photoId },
      select: {
        laughCount: true,
        loveCount: true,
        wowCount: true,
        voteCount: true,
        viewCount: true,
      },
    });

    return { updated, myReaction, isNew: !existing };
  });

  // The vote changed the numerator, so the community score has to move with it.
  await refreshCommunityScore(params.photoId);

  const scored = await prisma.photo.findUniqueOrThrow({
    where: { id: params.photoId },
    select: { communityScore: true, viewCount: true },
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
    reactions: {
      laugh: result.updated.laughCount,
      love: result.updated.loveCount,
      wow: result.updated.wowCount,
    },
    myReaction: result.myReaction,
    communityScore: scored.communityScore,
    viewCount: scored.viewCount,
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
