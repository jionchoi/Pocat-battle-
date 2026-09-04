import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  PAW_GIFT_SIZE,
  PAW_GRANT,
  canAfford,
  chooseBucket,
  grantResetsAt,
  nextPawCount,
  refuseGift,
  rollGrant,
  walletBalance,
  type GrantPeriod,
  type PawBucket,
  type PawMovement,
  type PawReason,
} from '../game/paws.js';

/**
 * Giving paws.
 *
 * The rules — the grant period and which bucket a gift comes out of — are in `game/paws.ts`
 * and are tested without a database. What is here is the part that cannot be: reading the two
 * tables, writing the ledger, and keeping `photos.paw_count` in step in the same request.
 *
 * ## A gift is final
 *
 * There is no undo and no reversal endpoint. `game/paws.ts` carries the argument; the
 * consequence here is that this file has exactly one write path, giving, and the ledger only
 * ever grows in one direction. `gift_undone` remains in the reason enum for a support
 * reversal done by hand, and nothing in this file writes it.
 *
 * ## Nothing in *this file* touches a ranked number
 *
 * No `community_score`, no `likes_received`, no `best_score`, no XP. `services/votes.ts` moves
 * all four and giving deliberately moves none of them.
 *
 * The reveal path in `services/photos.ts` is the exception and it is somewhere else on
 * purpose: spending a paw there earns the payer XP. Keeping that out of this file is not
 * tidiness — it is the boundary. Everything here is a transfer between two players, and a
 * transfer must never mint progression, or a pair of accounts could pass one paw back and
 * forth and rank up on it.
 *
 * ## Spending
 *
 * `spendFromWallet` below is the only way a paw leaves for anything other than a gift, and
 * every caller of it — the reveal path in `services/photos.ts`, the unlock path in
 * `services/shop.ts` — goes through that one function. That is on purpose: **spending is
 * wallet-only**, never the grant, and one function is the only way to make that a fact rather
 * than a convention four files agree to follow.
 *
 * Challenge entry fees are still unbuilt; so is the challenge vote bucket they would belong to.
 *
 * ## There are no transactions
 *
 * PostgREST gives us statements, not transactions, so a gift is three writes that can fail
 * between each other. They are ordered by what a partial failure costs: the giver's row
 * first (the spend, and the thing a refund would be computed from), then the recipient's,
 * then the cached counter. A failure after the first is a paw that left one balance without
 * arriving in the other, which the ledger makes visible and repairable; the reverse order
 * would credit a paw nobody paid for, which it does not.
 */

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

interface GrantRow {
  user_id: string;
  period_start: string;
  remaining: number;
}

interface LedgerRow {
  id: string;
  delta: number;
  reason: PawReason;
  bucket: PawBucket;
  created_at: string;
}

/** The shape both endpoints answer with, and what the client's `PawBalance` mirrors. */
export interface PawBalance {
  grant: { remaining: number; resetsAt: string };
  wallet: number;
}

/* -------------------------------------------------------------------------- */
/* Balance                                                                    */
/* -------------------------------------------------------------------------- */

/** `GET /paws/balance`. Settles the period as a side effect, which is the whole design. */
export async function balance(userId: string): Promise<PawBalance> {
  const [grant, wallet] = await Promise.all([settleGrant(userId), readWallet(userId)]);

  return {
    grant: { remaining: grant.remaining, resetsAt: grantResetsAt(grant.periodStart) },
    wallet,
  };
}

/**
 * The player's grant, rolled forward if the period has turned.
 *
 * Lazy settlement — no cron, for the reasons `game/paws.ts` and `services/challenges.ts` both
 * give. Called by every read and every spend, so the row is settled exactly when somebody
 * cares what it says and never otherwise.
 */
async function settleGrant(userId: string): Promise<GrantPeriod> {
  const { data, error } = await supabase
    .from('paw_grants')
    .select('user_id, period_start, remaining')
    .eq('user_id', userId)
    .maybeSingle<GrantRow>();

  if (error) throw error;

  const current: GrantPeriod | null = data
    ? { periodStart: data.period_start, remaining: data.remaining }
    : null;

  const next = rollGrant(current, new Date());
  if (!next.changed) return next;

  if (!data) {
    /*
     * A player's first ever grant.
     *
     * Two requests arriving together both find no row and both insert, and the loser gets a
     * unique violation on the primary key. That is a correct outcome rather than an error to
     * surface: the row now exists and says exactly what this one was going to write, so the
     * fix is to read it back. Answering 500 would mean the first two taps of a player's life
     * race each other.
     */
    const { error: insertError } = await supabase.from('paw_grants').insert({
      user_id: userId,
      period_start: next.periodStart,
      remaining: next.remaining,
    });

    if (insertError) {
      if (insertError.code !== '23505') throw insertError;
      return settleGrant(userId);
    }

    return next;
  }

  const { error: updateError } = await supabase
    .from('paw_grants')
    .update({ period_start: next.periodStart, remaining: next.remaining })
    .eq('user_id', userId);

  if (updateError) throw updateError;

  return next;
}

/**
 * The wallet, summed from the ledger.
 *
 * A whole read of one player's wallet rows per call, which is the honest cost of not keeping
 * a counter column — and the migration argues at length for why a counter was the wrong
 * trade. It is bounded by the player's own history rather than by anything global, and the
 * index on `(user_id, created_at desc)` makes it one range scan.
 *
 * If it ever becomes the thing that hurts, the answer is a periodically-written snapshot row
 * that later rows are summed on top of — not a mutable balance, which would put the product
 * back where it could not explain a number to the person who lost it.
 */
async function readWallet(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('paw_ledger')
    .select('delta, reason, bucket, created_at')
    .eq('user_id', userId)
    .eq('bucket', 'wallet');

  if (error) throw error;

  return walletBalance(toMovements(data));
}

/**
 * Rows to the shape `game/paws.ts` reasons about.
 *
 * The rename of `created_at` is the whole of it, and it is done here rather than by widening
 * `PawMovement` to accept either spelling — the pure module is where the rules live and it
 * should not have to know what a Postgres column is called.
 */
function toMovements(rows: unknown): PawMovement[] {
  return ((rows ?? []) as Omit<LedgerRow, 'id'>[]).map((row) => ({
    delta: row.delta,
    reason: row.reason,
    bucket: row.bucket,
    createdAt: row.created_at,
  }));
}

/* -------------------------------------------------------------------------- */
/* Giving                                                                     */
/* -------------------------------------------------------------------------- */

export interface GiftResult {
  pawCount: number;
  /** Which pot it actually came out of. The client words its confirmation toast from this. */
  bucket: PawBucket;
  balance: PawBalance;
}

/**
 * `POST /photos/:photoId/paw` — one paw, from whichever bucket the rules pick.
 *
 * Multiple paws to one photograph are allowed and that is the feature: a paw is a tip, not a
 * verdict, and there is no honest reason to cap how many times somebody may say "this one is
 * good". It is only safe because **giving** moves nothing ranked — `paw_count` is a display
 * number and a gift touches no score, no XP and no leaderboard. The same act on `votes` is
 * capped at one per person precisely because that one *is* ranked.
 *
 * (Spending a paw on a reveal does move XP; see the note in `game/paws.ts`. That is a
 * different act, deliberately, and it is capped by what a reveal costs rather than by a rule.)
 */
export async function give(userId: string, photoId: string): Promise<GiftResult> {
  const photo = await giftablePhoto(userId, photoId);

  const [grant, wallet] = await Promise.all([settleGrant(userId), readWallet(userId)]);

  const bucket = chooseBucket(grant.remaining, wallet);

  if (!bucket) {
    /*
     * A code, not just a status, because the client tells this refusal apart from the
     * self-gift one below and answers it differently: an empty balance gets a route to the
     * shop, and giving to yourself gets nothing, because there is nothing to fix.
     */
    throw new HttpError(409, 'You are out of paws.', 'no_paws');
  }

  await writeMovement({
    userId,
    delta: -PAW_GIFT_SIZE,
    reason: 'gift_sent',
    bucket,
    photoId,
    counterpartyId: photo.owner_id,
  });

  /*
   * The owner's side. Always `wallet` regardless of where it came from — a received paw does
   * not expire, and crediting it to the recipient's grant would both expire it and let one
   * player inflate another's weekly allowance.
   */
  await writeMovement({
    userId: photo.owner_id,
    delta: PAW_GIFT_SIZE,
    reason: 'gift_received',
    bucket: 'wallet',
    photoId,
    counterpartyId: userId,
  });

  const remaining =
    bucket === 'grant'
      ? await setGrantRemaining(userId, grant.remaining - PAW_GIFT_SIZE)
      : grant.remaining;

  const pawCount = await movePawCount(photoId, PAW_GIFT_SIZE);

  return {
    pawCount,
    bucket,
    balance: {
      grant: { remaining, resetsAt: grantResetsAt(grant.periodStart) },
      wallet: bucket === 'wallet' ? Math.max(0, wallet - PAW_GIFT_SIZE) : wallet,
    },
  };
}

/**
 * The photograph a paw is being given to, or a refusal.
 *
 * The same three-way shape as `votablePhoto` in `services/votes.ts`, and deliberately the
 * same status codes: a missing or unshared photo is a 404 rather than a 403, so an id that
 * happens to name somebody's private photograph is not confirmed as existing; your own is a
 * 409, because it exists and the refusal is about who is asking.
 *
 * **Neither bucket may be spent on your own work.** Not the grant and not the wallet — a
 * player tipping themselves is moving a paw from one of their pockets to another, and while
 * that costs nobody anything, it puts a number under their photograph that says other people
 * liked it. The client disables the control; anything reaching here has gone around it.
 */
async function giftablePhoto(userId: string, photoId: string) {
  const { data, error } = await supabase
    .from('photos')
    .select('id, owner_id, shared_to_feed')
    .eq('id', photoId)
    .maybeSingle<{ id: string; owner_id: string; shared_to_feed: boolean }>();

  if (error) throw error;

  const refusal = refuseGift(
    userId,
    data ? { ownerId: data.owner_id, sharedToFeed: data.shared_to_feed } : null
  );

  if (refusal === 'not_found') {
    throw new HttpError(404, 'That photo is not in the feed.');
  }

  if (refusal === 'own_photo') {
    throw new HttpError(409, 'You cannot give paws to your own photo.', 'own_photo');
  }

  return data!;
}

/* -------------------------------------------------------------------------- */
/* Spending                                                                   */
/* -------------------------------------------------------------------------- */

export interface SpendResult {
  spent: number;
  balance: PawBalance;
}

/**
 * Takes paws out of the wallet for something that is not a gift.
 *
 * The single spend path. A reveal and a catalogue unlock both come through here, and anything
 * added later must too — the reason being that this is where "the grant cannot be spent" is
 * enforced. The grant is not a parameter, it is not read, and there is no branch that could
 * fall through to it: `settleGrant` is called only to report the balance back, after the
 * money has already moved.
 *
 * ## The caller checks first, and this checks again
 *
 * Both the reveal path and the unlock path decide affordability before they act, because both
 * have to refuse with a message specific to what was being bought. This re-checks anyway. The
 * two reads are not redundant in the way they look: between the caller's check and this write
 * the player may have spent the same paws on another device, and a balance that can go
 * negative is one the ledger can never explain again.
 *
 * ## Not a transaction, and ordered accordingly
 *
 * The caller is expected to have already delivered the thing being paid for — the score is
 * written, the entitlement row exists — before calling this. That ordering is the same one
 * `applyScore` uses for the reveal ledger and it runs the risk the harmless way: a failure
 * here means the player keeps something they were not charged for. The opposite order charges
 * for something they did not get, which is the one outcome worth engineering against.
 */
export async function spendFromWallet(
  userId: string,
  spend: {
    cost: number;
    reason: Extract<PawReason, 'purchase' | 'reveal'>;
    /** The photograph a reveal was bought for. Null on a catalogue unlock. */
    photoId?: string | null;
    /** The catalogue id a purchase bought. Null on a reveal. */
    entryId?: string | null;
  }
): Promise<SpendResult> {
  const wallet = await readWallet(userId);

  if (!canAfford(wallet, spend.cost)) {
    throw new HttpError(409, 'You do not have enough paws for that.', 'no_paws');
  }

  // A free item is legal to author and costs no ledger row. Writing a zero-delta row would
  // violate `paw_ledger_delta_nonzero` and, worse, would mean nothing in the history.
  if (spend.cost > 0) {
    await writeMovement({
      userId,
      delta: -spend.cost,
      reason: spend.reason,
      bucket: 'wallet',
      photoId: spend.photoId ?? null,
      counterpartyId: null,
      entryId: spend.entryId ?? null,
    });
  }

  const grant = await settleGrant(userId);

  return {
    spent: spend.cost,
    balance: {
      grant: { remaining: grant.remaining, resetsAt: grantResetsAt(grant.periodStart) },
      wallet: Math.max(0, wallet - spend.cost),
    },
  };
}

/** The wallet on its own, for a caller deciding whether to offer a price. */
export async function walletOf(userId: string): Promise<number> {
  return readWallet(userId);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/** One ledger row. Append-only — there is deliberately no update or delete in this file. */
async function writeMovement(movement: {
  userId: string;
  delta: number;
  reason: PawReason;
  bucket: PawBucket;
  photoId: string | null;
  counterpartyId: string | null;
  entryId?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('paw_ledger').insert({
    user_id: movement.userId,
    delta: movement.delta,
    reason: movement.reason,
    bucket: movement.bucket,
    photo_id: movement.photoId,
    counterparty_id: movement.counterpartyId,
    entry_id: movement.entryId ?? null,
  });

  if (error) throw error;
}

/**
 * Writes the grant's remaining count and answers with what was written.
 *
 * Floored here as well as in the column's check constraint. The constraint is what makes an
 * overspend unrepresentable; this is what makes the failure a clamped number rather than a
 * 500 on a tap, if the read-then-write above ever races another request for the same player.
 */
async function setGrantRemaining(userId: string, remaining: number): Promise<number> {
  const clamped = Math.max(0, Math.min(PAW_GRANT, remaining));

  const { error } = await supabase
    .from('paw_grants')
    .update({ remaining: clamped })
    .eq('user_id', userId);

  if (error) throw error;

  return clamped;
}

/**
 * Moves the photograph's displayed count, and answers with the new value.
 *
 * Read then write, because PostgREST has no atomic increment — the same shape
 * `bumpViewCounts` uses in `services/votes.ts`. `game/paws.ts` explains why this increments
 * where votes recount: the ledger is the authority and this is a cache, so a lost update
 * here is a wrong display recoverable from the rows, not a lost paw.
 */
async function movePawCount(photoId: string, delta: number): Promise<number> {
  const { data, error } = await supabase
    .from('photos')
    .select('paw_count')
    .eq('id', photoId)
    .maybeSingle<{ paw_count: number | null }>();

  if (error) throw error;

  const next = nextPawCount(data?.paw_count ?? 0, delta);

  const { error: writeError } = await supabase
    .from('photos')
    .update({ paw_count: next })
    .eq('id', photoId);

  if (writeError) throw writeError;

  return next;
}
