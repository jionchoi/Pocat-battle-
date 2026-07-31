import type { Prisma } from '@prisma/client';

import { RANK_TIERS, nextRankTier, rankForXp } from '../game/rules';

/**
 * Photographer Rank (README section 1).
 *
 * Progression is deliberately cosmetic: rank unlocks filters, frames and gallery themes,
 * and has no effect on scoring. There is nothing to win competitively beyond votes and
 * leaderboard position, so there is nothing for rank to make unfair.
 *
 * Every XP change goes through `grantXp` so the ledger stays complete — the balance on
 * `User` is a cache of the ledger, not the other way round.
 */

export interface XpGrant {
  userId: string;
  amount: number;
  reason: string;
  refId?: string;
  /** Score to add to the player's lifetime total. Defaults to 0. */
  scoreDelta?: number;
}

export interface XpResult {
  photographerXp: number;
  photographerRank: number;
  rankUp: { from: number; to: number; title: string } | null;
}

export async function grantXp(
  tx: Prisma.TransactionClient,
  grant: XpGrant
): Promise<XpResult> {
  const user = await tx.user.update({
    where: { id: grant.userId },
    data: {
      photographerXp: { increment: grant.amount },
      lifetimeScore: { increment: grant.scoreDelta ?? 0 },
    },
    select: { photographerXp: true, photographerRank: true },
  });

  await tx.xpLedgerEntry.create({
    data: {
      userId: grant.userId,
      delta: grant.amount,
      reason: grant.reason,
      refId: grant.refId,
    },
  });

  const tier = rankForXp(user.photographerXp);

  // Rank is stored rather than derived on read so a rank-up is a single detectable
  // event — the reveal animation needs to know it happened on *this* capture.
  if (tier.rank === user.photographerRank) {
    return {
      photographerXp: user.photographerXp,
      photographerRank: user.photographerRank,
      rankUp: null,
    };
  }

  await tx.user.update({
    where: { id: grant.userId },
    data: { photographerRank: tier.rank },
  });

  return {
    photographerXp: user.photographerXp,
    photographerRank: tier.rank,
    rankUp: { from: user.photographerRank, to: tier.rank, title: tier.title },
  };
}

/** XP still needed to reach the next rank. Zero once the top tier is reached. */
export function xpToNextRank(xp: number): number {
  const current = rankForXp(xp);
  const next = nextRankTier(current.rank);
  return next ? Math.max(0, next.xpRequired - xp) : 0;
}

export { RANK_TIERS, rankForXp };
