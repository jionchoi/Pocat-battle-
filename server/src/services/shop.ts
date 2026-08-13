import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { catalogFor } from '../game/shop.js';

/**
 * The shop.
 *
 * A read, and only a read. `POST /shop/purchase` is deliberately not here: it grants
 * `pro_subscription_active`, validation against Apple and Google is the entire security of it,
 * and shipping it stubbed would be a self-service Pro button — which is the hole the 2026-08-13
 * migration closed, reopened through the front door.
 *
 * Everything this file decides comes from `game/shop.ts`. What it adds is the one query: who is
 * asking, and what have they got.
 */

export async function catalog(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('pro_subscription_active, player_stats ( rank )')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'We could not find your profile.');

  const row = data as unknown as {
    pro_subscription_active: boolean;
    // PostgREST types a to-one embed as an array when it cannot prove the cardinality, which is
    // the same accommodation `serializers/user.ts` and `lib/profile.ts` both make.
    player_stats: { rank: number }[] | { rank: number } | null;
  };

  const stats = Array.isArray(row.player_stats) ? row.player_stats[0] : row.player_stats;

  /*
   * Rank 1 rather than 0 when stats are missing.
   *
   * The signup trigger writes `player_stats` in the same transaction as the profile, so an
   * absent row should be unreachable — but the fallback has to be the rank a new player
   * actually starts at, or a missing row would lock the rank-1 items that everybody owns and
   * the shop would open with three rows greyed out for no reason anybody could see.
   */
  const rank = stats?.rank ?? 1;
  const proActive = row.pro_subscription_active === true;

  return {
    proActive,
    photographerRank: rank,
    items: catalogFor({ rank, proActive }),
  };
}
