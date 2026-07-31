import { config } from '../config';
import { prisma } from '../db/client';
import { logger } from '../logger';

/**
 * Push notifications via Expo's push service (README section 2).
 *
 * Every send is best-effort: a failed notification must never fail the action that
 * triggered it. Losing "your photo won the weekly challenge" is annoying; losing the
 * win itself because the push failed is a bug.
 *
 * No emoji in any body — the design system bans them, and that includes notifications.
 */

export type PushKind =
  | 'challenge-won'
  | 'challenge-closed'
  | 'vote-received'
  | 'rare-cat-nearby'
  | 'friend-request';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const REACTION_WORD: Record<string, string> = {
  laugh: 'laughed at',
  love: 'loved',
  wow: 'was impressed by',
};

const COPY: Record<PushKind, (ctx: Record<string, string>) => PushPayload> = {
  'challenge-won': (ctx) => ({
    title: 'You won the challenge',
    body: `Your photo took first place in ${ctx.challengeTitle ?? 'this week'}.`,
    data: { screen: 'ChallengesHub' },
  }),
  'challenge-closed': (ctx) => ({
    title: 'Challenge results are in',
    body: `${ctx.challengeTitle ?? 'This week'} has closed. See who won.`,
    data: { screen: 'ChallengesHub' },
  }),
  'vote-received': (ctx) => ({
    title: 'Someone reacted to your shot',
    body: `A player ${REACTION_WORD[ctx.reaction ?? ''] ?? 'reacted to'} one of your photos.`,
    data: { screen: 'PhotoDetail', photoId: ctx.photoId },
  }),
  'rare-cat-nearby': (ctx) => ({
    title: 'A rare cat was spotted nearby',
    body: ctx.detail ?? 'Someone photographed an unusual cat close to you.',
    data: { screen: 'Map' },
  }),
  'friend-request': (ctx) => ({
    title: 'New friend request',
    body: `${ctx.username ?? 'A player'} wants to be friends.`,
    data: { screen: 'FriendsList' },
  }),
};

/**
 * Per-kind opt-out. The Settings screen exposes three toggles, and a player who turned
 * one off must not receive that kind — checked here rather than at each call site so a
 * new trigger cannot forget to honour it.
 */
const PREFERENCE_FIELD: Partial<Record<PushKind, 'pushChallengeResults' | 'pushVotes' | 'pushNearbyRareCats'>> = {
  'challenge-won': 'pushChallengeResults',
  'challenge-closed': 'pushChallengeResults',
  'vote-received': 'pushVotes',
  'rare-cat-nearby': 'pushNearbyRareCats',
};

export async function sendPush(params: {
  userId: string;
  kind: PushKind;
  context?: Record<string, string>;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        pushToken: true,
        pushChallengeResults: true,
        pushVotes: true,
        pushNearbyRareCats: true,
      },
    });

    if (!user?.pushToken) return;

    const preference = PREFERENCE_FIELD[params.kind];
    if (preference && !user[preference]) return;

    const payload = COPY[params.kind](params.context ?? {});

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (config.EXPO_ACCESS_TOKEN) {
      headers.authorization = `Bearer ${config.EXPO_ACCESS_TOKEN}`;
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: user.pushToken,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data,
      }),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, kind: params.kind },
        'push send returned an error'
      );
      return;
    }

    const json = (await response.json()) as {
      data?: { status: string; details?: { error?: string } };
    };

    // A device that uninstalled the app keeps failing forever unless we clear the token.
    if (json.data?.details?.error === 'DeviceNotRegistered') {
      await prisma.user.update({
        where: { id: params.userId },
        data: { pushToken: null },
      });
    }
  } catch (err) {
    logger.error({ err, kind: params.kind }, 'push send failed');
  }
}

/* ----------------------------- typed triggers ----------------------------- */

export function notifyChallengeResult(params: {
  userId: string;
  challengeTitle: string;
  won: boolean;
}): Promise<void> {
  return sendPush({
    userId: params.userId,
    kind: params.won ? 'challenge-won' : 'challenge-closed',
    context: { challengeTitle: params.challengeTitle },
  });
}

export function notifyVoteReceived(params: {
  userId: string;
  reaction: string;
  photoId: string;
}): Promise<void> {
  return sendPush({
    userId: params.userId,
    kind: 'vote-received',
    context: { reaction: params.reaction, photoId: params.photoId },
  });
}

export function notifyFriendRequest(params: {
  userId: string;
  username: string;
}): Promise<void> {
  return sendPush({
    userId: params.userId,
    kind: 'friend-request',
    context: { username: params.username },
  });
}

export async function registerPushToken(params: {
  userId: string;
  token: string;
}): Promise<void> {
  await prisma.user.update({
    where: { id: params.userId },
    data: { pushToken: params.token },
  });
}

export async function clearPushToken(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { pushToken: null } });
}
