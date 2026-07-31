import { prisma } from '../db/client';
import { errors } from '../errors';
import { CHALLENGE_CONFIG, XP } from '../game/rules';
import { logger } from '../logger';
import { notifyChallengeResult } from '../integrations/push';
import { grantXp } from './progressionService';

/**
 * Weekly and seasonal challenges (README section 9.4).
 *
 * Prompts rotate on a schedule, one entry per player per challenge, and the winner is
 * decided at close by either top score or community reception depending on the prompt —
 * an objective prompt ("sharpest shot") can be scored, a subjective one ("funniest")
 * genuinely cannot, so it goes to a vote.
 *
 * The fixed window is load-bearing for fairness: an open-ended board lets an old photo
 * coast on accumulated votes forever, so challenges resolve on a schedule and start
 * clean. Vote-judged winners are decided on the smoothed engagement ratio, so reach
 * does not decide the outcome.
 */

/**
 * The rotating prompt pool. Kept in code rather than the database because these are
 * content, not configuration — they ship with a release and get reviewed like copy.
 */
export const CHALLENGE_PROMPTS: {
  slug: string;
  title: string;
  prompt: string;
  judging: 'score' | 'votes';
}[] = [
  {
    slug: 'sleepiest-cat',
    title: 'Sleepiest cat of the week',
    prompt: 'Find the most thoroughly asleep cat in your neighbourhood.',
    judging: 'votes',
  },
  {
    slug: 'mid-air',
    title: 'Caught mid-air',
    prompt: 'A cat with all four feet off the ground. Timing is everything.',
    judging: 'score',
  },
  {
    slug: 'golden-hour',
    title: 'Golden hour',
    prompt: 'Shoot a cat in the last hour of good light.',
    judging: 'score',
  },
  {
    slug: 'somewhere-it-should-not-be',
    title: 'Somewhere it should not be',
    prompt: 'A cat that has installed itself somewhere ridiculous.',
    judging: 'votes',
  },
  {
    slug: 'the-loaf',
    title: 'The perfect loaf',
    prompt: 'Maximum loaf. No legs should be visible.',
    judging: 'votes',
  },
  {
    slug: 'best-expression',
    title: 'Best expression',
    prompt: 'A cat clearly having a thought. We want to know what it is.',
    judging: 'votes',
  },
  {
    slug: 'street-portrait',
    title: 'Street portrait',
    prompt: 'A well-framed, well-lit portrait of a cat that lives outdoors.',
    judging: 'score',
  },
];

export async function activeChallenges(userId: string) {
  const now = new Date();

  const challenges = await prisma.challenge.findMany({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { endsAt: 'asc' },
  });

  return decorate(challenges, userId);
}

export async function pastChallenges(userId: string, limit = 10) {
  const now = new Date();

  const challenges = await prisma.challenge.findMany({
    where: { endsAt: { lte: now } },
    orderBy: { endsAt: 'desc' },
    take: limit,
  });

  return decorate(challenges, userId);
}

async function decorate(
  challenges: Awaited<ReturnType<typeof prisma.challenge.findMany>>,
  userId: string
) {
  if (challenges.length === 0) return [];

  const ids = challenges.map((c) => c.id);

  const [counts, mine] = await Promise.all([
    prisma.photo.groupBy({
      by: ['submittedToChallengeId'],
      where: { submittedToChallengeId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.photo.findMany({
      where: { ownerId: userId, submittedToChallengeId: { in: ids } },
      select: { id: true, submittedToChallengeId: true },
    }),
  ]);

  const countById = new Map(
    counts.map((c) => [c.submittedToChallengeId, c._count._all])
  );
  const mineById = new Map(mine.map((p) => [p.submittedToChallengeId, p.id]));

  return challenges.map((challenge) => ({
    challenge,
    submissionCount: countById.get(challenge.id) ?? 0,
    mySubmissionPhotoId: mineById.get(challenge.id) ?? null,
  }));
}

/**
 * Enters a photo into a challenge.
 *
 * One entry per player per challenge: resubmitting moves the entry rather than adding a
 * second, so a player cannot flood a prompt with their whole album. XP is granted only
 * on the first entry, for the same reason.
 */
export async function submitToChallenge(params: {
  userId: string;
  challengeId: string;
  photoId: string;
}) {
  const now = new Date();

  const challenge = await prisma.challenge.findUnique({
    where: { id: params.challengeId },
  });
  if (!challenge) throw errors.notFound('That challenge no longer exists.');

  if (challenge.startsAt > now) {
    throw errors.badRequest('That challenge has not opened yet.');
  }
  if (challenge.endsAt <= now) {
    throw errors.badRequest('That challenge has closed.');
  }

  const photo = await prisma.photo.findUnique({ where: { id: params.photoId } });
  if (!photo) throw errors.notFound('That photo no longer exists.');
  if (photo.ownerId !== params.userId) throw errors.forbidden('That photo is not yours.');

  const existing = await prisma.photo.findFirst({
    where: { ownerId: params.userId, submittedToChallengeId: challenge.id },
    include: { cat: true, votes: { where: { voterId: params.userId } } },
  });

  if (existing?.id === photo.id) {
    return { photo: existing, alreadyEntered: true };
  }

  return prisma.$transaction(async (tx) => {
    if (existing) {
      // Withdraw the previous entry. Entering also shares the photo, so withdrawing
      // does not un-share it — the player can still un-share it themselves.
      await tx.photo.update({
        where: { id: existing.id },
        data: { submittedToChallengeId: null },
      });
    }

    const updated = await tx.photo.update({
      where: { id: photo.id },
      data: {
        submittedToChallengeId: challenge.id,
        // A challenge entry is inherently public — it has to be visible to be judged.
        sharedToFeed: true,
      },
      include: { cat: true, votes: { where: { voterId: params.userId } } },
    });

    if (!existing) {
      await grantXp(tx, {
        userId: params.userId,
        amount: XP.challengeEntry,
        reason: 'challenge-entry',
        refId: challenge.id,
      });
    }

    return { photo: updated, alreadyEntered: false };
  });
}

export async function challengeEntries(challengeId: string, viewerId: string, limit = 50) {
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge) throw errors.notFound('That challenge no longer exists.');

  return prisma.photo.findMany({
    where: { submittedToChallengeId: challengeId },
    // Vote-judged challenges rank by the smoothed engagement ratio, not raw vote count.
    // Raw counts would just re-elect whoever has the most followers, which is the exact
    // bias the ratio exists to remove.
    orderBy:
      challenge.judging === 'votes'
        ? [{ communityScore: 'desc' }, { voteCount: 'desc' }]
        : [{ total: 'desc' }, { communityScore: 'desc' }],
    take: limit,
    include: {
      cat: true,
      owner: { select: { id: true, username: true, avatarUrl: true, photographerRank: true } },
      votes: { where: { voterId: viewerId } },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Scheduled rotation and judging                                             */
/* -------------------------------------------------------------------------- */

/**
 * Closes any challenge past its end date and opens the next prompt.
 *
 * Run by the scheduled job (README 9.4). Idempotent: `closedAt` guards judging, and an
 * already-open challenge short-circuits the opening step, so running it twice in the
 * same minute changes nothing.
 */
export async function rotateChallenges(now = new Date()): Promise<{
  closed: number;
  opened: number;
}> {
  const due = await prisma.challenge.findMany({
    where: { endsAt: { lte: now }, closedAt: null },
  });

  let closed = 0;
  for (const challenge of due) {
    try {
      await judgeChallenge(challenge.id, now);
      closed += 1;
    } catch (err) {
      logger.error({ err, challengeId: challenge.id }, 'challenge judging failed');
    }
  }

  const active = await prisma.challenge.count({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
  });

  let opened = 0;
  if (active === 0) {
    await openNextChallenge(now);
    opened = 1;
  }

  return { closed, opened };
}

export async function judgeChallenge(challengeId: string, now = new Date()) {
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.closedAt) return null;

  const entries = await prisma.photo.findMany({
    where: { submittedToChallengeId: challengeId },
    orderBy:
      challenge.judging === 'votes'
        ? [{ communityScore: 'desc' }, { voteCount: 'desc' }]
        : [{ total: 'desc' }, { communityScore: 'desc' }],
    take: 1,
  });

  const entryCount = await prisma.photo.count({
    where: { submittedToChallengeId: challengeId },
  });

  // A challenge with almost no entries is voided rather than crowning whoever showed up
  // — an uncontested "win" is not worth anything to the player who gets it.
  if (entryCount < CHALLENGE_CONFIG.minEntriesToJudge || entries.length === 0) {
    await prisma.challenge.update({
      where: { id: challengeId },
      data: { closedAt: now },
    });
    return null;
  }

  const winner = entries[0];

  await prisma.$transaction(async (tx) => {
    await tx.challenge.update({
      where: { id: challengeId },
      data: { closedAt: now, winningPhotoId: winner.id },
    });

    await grantXp(tx, {
      userId: winner.ownerId,
      amount: XP.challengeWin,
      reason: 'challenge-win',
      refId: challengeId,
    });
  });

  notifyChallengeResult({
    userId: winner.ownerId,
    challengeTitle: challenge.title,
    won: true,
  }).catch((err) => logger.error({ err }, 'challenge result notification failed'));

  return winner;
}

/** Opens the prompt that has gone longest without being used. */
export async function openNextChallenge(now = new Date()) {
  const used = await prisma.challenge.findMany({
    orderBy: { startsAt: 'desc' },
    select: { slug: true, startsAt: true },
  });

  const lastUsedAt = new Map(used.map((c) => [c.slug, c.startsAt.getTime()]));

  const next =
    CHALLENGE_PROMPTS.slice().sort(
      (a, b) => (lastUsedAt.get(a.slug) ?? 0) - (lastUsedAt.get(b.slug) ?? 0)
    )[0] ?? CHALLENGE_PROMPTS[0];

  const endsAt = new Date(
    now.getTime() + CHALLENGE_CONFIG.durationDays * 24 * 3600 * 1000
  );

  return prisma.challenge.create({
    data: {
      // Slugs repeat as prompts cycle, so the stored slug is uniquified by start date.
      slug: `${next.slug}-${now.toISOString().slice(0, 10)}`,
      title: next.title,
      prompt: next.prompt,
      judging: next.judging,
      startsAt: now,
      endsAt,
    },
  });
}
