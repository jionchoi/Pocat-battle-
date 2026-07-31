import { prisma } from '../db/client';
import { errors } from '../errors';
import { notifyFriendRequest } from '../integrations/push';

/**
 * Friends (README section 5.6).
 *
 * A friendship is one row with a direction plus an `accepted` flag, rather than two
 * mirrored rows. That keeps "pending request" representable without a second table and
 * makes the unique constraint do the duplicate-request check for us.
 */

export async function friendList(userId: string) {
  const rows = await prisma.friendship.findMany({
    where: {
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: {
        select: { id: true, username: true, avatarUrl: true, photographerRank: true },
      },
      addressee: {
        select: { id: true, username: true, avatarUrl: true, photographerRank: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const friends = [];
  const incoming = [];
  const outgoing = [];

  for (const row of rows) {
    const isRequester = row.requesterId === userId;
    const other = isRequester ? row.addressee : row.requester;

    if (row.accepted) friends.push(other);
    else if (isRequester) outgoing.push(other);
    else incoming.push({ ...other, friendshipId: row.id });
  }

  return { friends, incoming, outgoing };
}

export async function searchUsers(params: { query: string; excludeUserId: string }) {
  const query = params.query.trim();

  if (query.length < 2) {
    throw errors.badRequest('Search needs at least two characters.');
  }

  return prisma.user.findMany({
    where: {
      username: { contains: query, mode: 'insensitive' },
      id: { not: params.excludeUserId },
    },
    take: 20,
    select: { id: true, username: true, avatarUrl: true, photographerRank: true },
  });
}

export async function requestFriend(params: {
  requesterId: string;
  addresseeUsername: string;
}) {
  const addressee = await prisma.user.findUnique({
    where: { username: params.addresseeUsername.trim() },
    select: { id: true, username: true },
  });

  if (!addressee) throw errors.notFound('We could not find that player.');
  if (addressee.id === params.requesterId) {
    throw errors.badRequest('You cannot add yourself.');
  }

  // If they already requested us, accept theirs instead of creating a mirrored row.
  const reverse = await prisma.friendship.findUnique({
    where: {
      requesterId_addresseeId: {
        requesterId: addressee.id,
        addresseeId: params.requesterId,
      },
    },
  });

  if (reverse) {
    await prisma.friendship.update({
      where: { id: reverse.id },
      data: { accepted: true },
    });
    return { status: 'accepted' as const, userId: addressee.id };
  }

  const existing = await prisma.friendship.findUnique({
    where: {
      requesterId_addresseeId: {
        requesterId: params.requesterId,
        addresseeId: addressee.id,
      },
    },
  });

  if (existing) {
    return {
      status: existing.accepted ? ('accepted' as const) : ('pending' as const),
      userId: addressee.id,
    };
  }

  await prisma.friendship.create({
    data: { requesterId: params.requesterId, addresseeId: addressee.id },
  });

  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: params.requesterId },
    select: { username: true },
  });

  await notifyFriendRequest({
    userId: addressee.id,
    username: requester.username,
  });

  return { status: 'pending' as const, userId: addressee.id };
}

export async function respondToRequest(params: {
  userId: string;
  friendshipId: string;
  accept: boolean;
}) {
  const friendship = await prisma.friendship.findUnique({
    where: { id: params.friendshipId },
  });

  if (!friendship) throw errors.notFound('That request no longer exists.');

  // Only the addressee can accept — otherwise a requester could self-accept.
  if (friendship.addresseeId !== params.userId) {
    throw errors.forbidden('That request is not yours to answer.');
  }

  if (params.accept) {
    await prisma.friendship.update({
      where: { id: friendship.id },
      data: { accepted: true },
    });
    return { status: 'accepted' as const };
  }

  await prisma.friendship.delete({ where: { id: friendship.id } });
  return { status: 'declined' as const };
}

export async function removeFriend(params: { userId: string; otherUserId: string }) {
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: params.userId, addresseeId: params.otherUserId },
        { requesterId: params.otherUserId, addresseeId: params.userId },
      ],
    },
  });
}
