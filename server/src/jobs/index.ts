import cron from 'node-cron';

import { prisma } from '../db/client';
import { logger } from '../logger';
import { rotateChallenges } from '../services/challengeService';
import { recomputeLeaderboards } from '../services/leaderboardService';
import { expireLapsedPro } from '../services/shopService';

/**
 * Scheduled jobs.
 *
 * Every task is wrapped so a thrown error is logged rather than taking the process down —
 * a failed leaderboard recompute must not restart the API. Each job also guards against
 * overlapping runs, because a slow run plus a fixed schedule otherwise stacks up.
 */

const running = new Set<string>();

function job(name: string, schedule: string, task: () => Promise<unknown>) {
  return cron.schedule(schedule, async () => {
    if (running.has(name)) {
      logger.warn({ job: name }, 'previous run still in progress — skipping');
      return;
    }

    running.add(name);
    const startedAt = Date.now();

    try {
      const result = await task();
      logger.info({ job: name, ms: Date.now() - startedAt, result }, 'job finished');
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
    } finally {
      running.delete(name);
    }
  });
}

export function startJobs(): () => void {
  const tasks = [
    /**
     * Leaderboards. Every 15 minutes rather than on demand — ranking every player on each
     * profile view is the thing that works at 200 users and falls over at 20,000.
     */
    job('leaderboards', '*/15 * * * *', recomputeLeaderboards),

    /**
     * Challenge rotation and judging (README 9.4). Runs every 10 minutes rather than
     * weekly: the schedule only has to be fine enough to close a challenge promptly
     * after its end time, and a frequent idempotent check is far more robust than one
     * weekly run that fails silently if the process happened to be restarting.
     */
    job('challenges', '*/10 * * * *', () => rotateChallenges()),

    /**
     * Expired sightings. The TTL is stored as a column so this is an indexed range delete
     * rather than a full scan computing intervals per row.
     */
    job('sighting-cleanup', '20 * * * *', async () => {
      const result = await prisma.catSighting.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      return { deleted: result.count };
    }),

    /**
     * Revoked and expired refresh tokens. Rotation on every refresh means this table grows
     * quickly and needs pruning.
     */
    job('token-cleanup', '35 3 * * *', async () => {
      const result = await prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { revokedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
          ],
        },
      });
      return { deleted: result.count };
    }),

    /**
     * Lapsed Pro subscriptions. The stores do not reliably notify us the moment a
     * subscription ends, so we check rather than wait.
     */
    job('pro-expiry', '50 * * * *', async () => {
      const count = await expireLapsedPro();
      return { expired: count };
    }),
  ];

  logger.info({ count: tasks.length }, 'scheduled jobs started');

  return () => {
    for (const task of tasks) task.stop();
    logger.info('scheduled jobs stopped');
  };
}
