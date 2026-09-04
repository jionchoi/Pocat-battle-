import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { catalogFor, entryById, unlockRefusal, type Entitlements } from '../game/shop.js';
import { spendFromWallet, walletOf } from './paws.js';

/**
 * The shop.
 *
 * ## Two doors, and only one of them is open
 *
 * `POST /shop/purchase` — the **money** door — is still deliberately not here. It grants
 * `pro_subscription_active`, validation against Apple and Google is the entire security of it,
 * and shipping it stubbed would be a self-service Pro button, which is the hole the 2026-08-13
 * migration closed reopened through the front door.
 *
 * `POST /shop/unlock` — the **paw** door — is here, and it is safe for the reason the other
 * one is not: paws are a currency this server issued and can account for, so nothing has to be
 * validated against a third party. The worst a forged request can do is fail an affordability
 * check we compute ourselves.
 *
 * Pro is not reachable through either door today, and through the paw door it must never be:
 * it is the one entry that is not cosmetic, and `unlockRefusal` refuses it because its
 * `pawPrice` is null. See the note there.
 *
 * Everything this file decides comes from `game/shop.ts`. What it adds is the queries: who is
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

  const [unlockedIds, walletBalance] = await Promise.all([
    unlockedIdsOf(userId),
    walletOf(userId),
  ]);

  return {
    proActive,
    photographerRank: rank,
    /*
     * The wallet rides along with the catalogue.
     *
     * The screen draws a paw price on every purchasable row and has to know whether the player
     * can meet it — without this it would need a second request to render one screen, and the
     * two answers could disagree about the balance by the time both landed.
     */
    walletBalance,
    items: catalogFor({ rank, proActive, unlockedIds, walletBalance }),
  };
}

/**
 * Who the caller is, as `game/shop.ts` needs to see them.
 *
 * Pulled out because the unlock path needs exactly the same picture the catalogue read does —
 * and a second, subtly different version of "what does this player own" is how an item comes
 * to be purchasable on one screen and already-owned on another.
 */
async function entitlementsOf(userId: string): Promise<Entitlements> {
  const { data, error } = await supabase
    .from('profiles')
    .select('pro_subscription_active, player_stats ( rank )')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'We could not find your profile.');

  const row = data as unknown as {
    pro_subscription_active: boolean;
    player_stats: { rank: number }[] | { rank: number } | null;
  };

  const stats = Array.isArray(row.player_stats) ? row.player_stats[0] : row.player_stats;

  const [unlockedIds, walletBalance] = await Promise.all([
    unlockedIdsOf(userId),
    walletOf(userId),
  ]);

  return {
    rank: stats?.rank ?? 1,
    proActive: row.pro_subscription_active === true,
    unlockedIds,
    walletBalance,
  };
}

/** What this player has bought. Rank unlocks are not in this table — see the migration. */
async function unlockedIdsOf(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('entitlements')
    .select('entry_id')
    .eq('user_id', userId);

  if (error) throw error;

  return (data ?? []).map((entitlement) => entitlement.entry_id as string);
}

/* -------------------------------------------------------------------------- */
/* Unlocking with paws                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `POST /shop/unlock` — buys one catalogue item with paws.
 *
 * ## The entitlement is written before the paws are taken
 *
 * The same ordering `applyScore` uses for the reveal ledger, and the same argument: there are
 * no transactions through PostgREST, so one of the two writes can land alone. Granting first
 * means a failure leaves the player owning something they were not charged for; charging first
 * means they paid for something they did not get. Only one of those is survivable as a support
 * ticket, and it is not the second.
 *
 * ## Why the price is not in the request
 *
 * The client draws `pawPrice` from a catalogue it fetched, which may be minutes old and is in
 * any case a number the caller controls. The authored row is the only price this endpoint will
 * charge, and `entitlements.paw_cost` records what was actually taken so a later price change
 * cannot rewrite history.
 */
export async function unlock(userId: string, entryId: string) {
  const entry = entryById(entryId);
  const who = await entitlementsOf(userId);

  const refusal = unlockRefusal(entry, who);

  if (refusal === 'unknown_item') {
    throw new HttpError(404, 'That item is not in the shop.');
  }
  if (refusal === 'already_owned') {
    throw new HttpError(409, 'You already have that.', 'already_owned');
  }
  if (refusal === 'not_for_paws') {
    throw new HttpError(409, 'That one cannot be unlocked with paws.', 'not_for_paws');
  }
  if (refusal === 'insufficient_paws') {
    throw new HttpError(409, 'You do not have enough paws for that.', 'no_paws');
  }

  // `unlockRefusal` returning null guarantees both of these; the assertions are for the
  // compiler, which cannot see that far through the refusal enum.
  const priced = entry!;
  const cost = priced.pawPrice!;

  const { error } = await supabase
    .from('entitlements')
    .insert({ user_id: userId, entry_id: priced.id, paw_cost: cost });

  if (error) {
    /*
     * A duplicate means two taps raced and the other one won. The player owns the item and has
     * been charged once, which is the correct end state — so this answers the refusal a second
     * deliberate tap would get rather than a 500 about a constraint.
     */
    if (error.code === '23505') {
      throw new HttpError(409, 'You already have that.', 'already_owned');
    }
    throw error;
  }

  await spendFromWallet(userId, { cost, reason: 'purchase', entryId: priced.id });

  /*
   * The whole catalogue comes back, not just the row that changed.
   *
   * One unlock can move more than one row's state: the wallet falls, which can take every
   * other paw price out of reach. A response carrying only the bought item would leave the
   * screen showing affordable prices the player can no longer meet.
   */
  return { unlocked: priced.id, ...(await catalog(userId)) };
}
