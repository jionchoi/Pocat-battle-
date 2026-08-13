import { supabase } from '../lib/supabase.js';
import {
  rankForXp,
  rankTitle,
  xpForScore,
  xpToNextRank,
} from '../game/progression.js';

/**
 * Writing progression.
 *
 * The rules are in `game/progression.ts` and have no database under them; this is the part
 * that reads `player_stats`, applies them, and writes back.
 *
 * ## Why this is a read-modify-write and not an increment
 *
 * `rank` is derived from `xp` but stored beside it, so the two have to move together — and
 * the new rank cannot be expressed as an increment of the old one. PostgREST has no atomic
 * `update ... set xp = xp + $1 returning *`, so the row is read, the arithmetic happens here,
 * and the result is written.
 *
 * The race that leaves is two scores landing for one player at the same instant, where the
 * later write could carry a total computed before the earlier one landed and lose it. It is
 * survivable and deliberately not defended against: a player has at most two reveals a day,
 * both are their own deliberate taps seconds apart at the very least, and the cost of the
 * collision is one photograph's XP. The fix is a Postgres function, which is a migration and
 * a second place for the ramp to live — worth doing when the feed starts awarding XP for
 * reactions, where the writes really are concurrent and not the player's own.
 */

export interface Award {
  xpAwarded: number;
  /** Totals *after* this award, which is what the client's meter should draw. */
  xp: number;
  rank: number;
  /** Set only when this award crossed a threshold. The moment worth celebrating. */
  rankUp: { from: number; to: number; title: string } | null;
  xpToNextRank: number;
  /** True when this photograph is the player's best ever. */
  personalBest: boolean;
  bestScore: number;
}

/**
 * Credits a scored photograph.
 *
 * Called once per score that actually lands — never on a failed scoring attempt, and never
 * on a photograph scored a second time, because there is no such thing. `reveal` refuses a
 * photo that already has a score, so the two entry points cannot both pay for one row.
 *
 * `best_score` is a floor that only ever rises. It is what the leaderboard ranks on, and
 * deleting the photograph that set it does *not* lower it — the same reasoning as the reveal
 * ledger outliving its photo. You took that shot.
 */
export async function awardForScore(
  userId: string,
  scoreTotal: number
): Promise<Award | null> {
  return credit(userId, xpForScore(scoreTotal), Math.round(scoreTotal));
}

/**
 * XP for something that is not a photograph's score — winning a challenge, so far.
 *
 * Separate entry point rather than a flag on the one above, because `best_score` must not
 * move: it is the highest single-photo score a player has ever *reached*, and a challenge
 * prize is not a photograph. Folding the two together would mean a reward could set a
 * personal best nobody photographed.
 */
export async function awardXp(userId: string, xp: number): Promise<Award | null> {
  return credit(userId, Math.max(0, Math.round(xp)), null);
}

async function credit(
  userId: string,
  gained: number,
  scoreTotal: number | null
): Promise<Award | null> {

  const { data: stats, error } = await supabase
    .from('player_stats')
    .select('xp, rank, best_score')
    .eq('user_id', userId)
    .maybeSingle<{ xp: number; rank: number; best_score: number }>();

  if (error) throw error;

  /*
   * No stats row. The signup trigger creates one, so this is a genuinely broken account
   * rather than a new one — and it is not worth failing a capture over. The photograph and
   * its score are already written; refusing here would report an error for a request that
   * did the thing the player asked for.
   */
  if (!stats) {
    console.warn('[progression] no player_stats row for', userId);
    return null;
  }

  const xp = stats.xp + gained;
  const rank = Math.max(stats.rank, rankForXp(xp));
  const bestScore =
    scoreTotal === null ? stats.best_score : Math.max(stats.best_score, scoreTotal);

  const { error: writeError } = await supabase
    .from('player_stats')
    .update({ xp, rank, best_score: bestScore })
    .eq('user_id', userId);

  if (writeError) throw writeError;

  return {
    xpAwarded: gained,
    xp,
    rank,
    rankUp:
      rank > stats.rank ? { from: stats.rank, to: rank, title: rankTitle(rank) } : null,
    xpToNextRank: xpToNextRank(xp, rank),
    // Strictly greater, so re-scoring an identical total does not claim a new best. Always
    // false for an award with no photograph behind it.
    personalBest: scoreTotal !== null && scoreTotal > stats.best_score,
    bestScore,
  };
}
