/**
 * The paw economy's rules.
 *
 * Paws are the in-app currency: given to other players' photographs, and spent on score
 * reveals and on catalogue items that carry a paw price.
 * *
 * ## What paws do and do not touch, as of 2026-08-31
 *
 * **Giving a paw still moves nothing ranked.** `paw_count` is a display number; no gift
 * touches `community_score`, `best_score`, `likes_received` or XP, and that is what keeps it
 * safe for one person to tip the same photograph many times.
 *
 * **Spending one on a reveal does move XP**, and therefore Photographer Rank, because
 * revealing is an act the game rewards and the reward goes to whoever performed it. So the
 * blanket claim "paws feed nothing ranked" is no longer true and is not written anywhere in
 * this codebase any more.
 *
 * What survives, and it is the promise that actually mattered: **rank unlocks cosmetics
 * only**. Paws can buy progression; they still cannot buy power. `best_score` — the number the
 * leaderboards rank photographs on — goes to the photographer whoever paid, so no amount of
 * spending puts somebody else's work under your name.
 *
 * Free reactions remain the only thing that moves `community_score`, which is what the feed
 * and the leaderboards rank on. Nothing here touches that.
 *
 * Pure, so `scripts/check-paws.ts` exercises the period roll and the bucket choice with no
 * Supabase project and no key. The split is the one BACKEND.md §7 describes, and it is the
 * reason the arithmetic here has real tests where the service around it does not — this is
 * where the rules that can be wrong *quietly* live.
 */

/* -------------------------------------------------------------------------- */
/* The constants                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Paws granted at the start of every period.
 *
 * Seven is one a day at a weekly cadence, which is the rate the number is trying to suggest:
 * enough that giving is the ordinary response to a good photograph rather than a decision,
 * few enough that spending them all still means something.
 *
 * Mirrored by `PAW_CONFIG.grant` in the client's `src/constants/game.ts`, which draws the
 * toast — and the two are asserted to agree, because a client that says "6 left this week"
 * over a server that granted five is a client lying about money.
 */
export const PAW_GRANT = 7;

/**
 * How long a grant period lasts, in hours. 168 is a week.
 *
 * **This is the one line to change if the grant should be daily.** It is here, alone, and
 * everything else derives from it: the reset time the client shows, the roll in `rollGrant`,
 * and the client's mirrored copy. Changing it to 24 is the whole change.
 */
export const PAW_GRANT_WINDOW_HOURS = 168;

export const PAW_GRANT_WINDOW_MS = PAW_GRANT_WINDOW_HOURS * 3600_000;

/**
 * ## A gift is final
 *
 * There is deliberately **no undo**, and no window constant here to configure one. A paw that
 * has been given has been given: the recipient's wallet has it, their photograph's count shows
 * it, and neither number goes backwards.
 *
 * This was built the other way first — a sixty-second take-back with an undo toast — and it
 * was cut on purpose. A gift that can evaporate is not a gift. The recipient is the person the
 * feature exists for, and the version with undo means every paw they see is provisional for a
 * minute, so a count going *down* becomes an ordinary event on somebody else's screen.
 *
 * What that costs: a mis-tap is unrecoverable. That is an acceptable price at one paw, and it
 * is why the tap still gets a toast — the player is told what they spent and what is left, in
 * the same breath, even though there is nothing to press. See `usePawGift`.
 *
 * `gift_undone` survives in the reason enum below and nothing writes it. It is there for a
 * *support* reversal run by hand against the ledger — being able to put a paw back for
 * somebody who was wronged is the entire argument for this being a ledger rather than a
 * counter, and that argument does not depend on players having a button.
 */

/**
 * Which pot a paw came out of.
 *
 * There is a third — the per-challenge vote token — and it is not built. When it is, it
 * joins this union and the `paw_ledger_bucket_known` constraint in the same change; see the
 * note in 2026-08-29_paws.sql about why that is one line rather than a migration of rows.
 */
export type PawBucket = 'grant' | 'wallet';

/** Every way a paw can move. Mirrors `paw_ledger_reason_known`. */
export type PawReason =
  | 'gift_sent'
  | 'gift_received'
  | 'gift_undone'
  | 'purchase'
  | 'reveal'
  | 'challenge_prize';

/* -------------------------------------------------------------------------- */
/* Spending                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a score reveal costs in paws.
 *
 * ## This number is not settled
 *
 * It is a placeholder with a real value in it, so the path works end to end and can be played
 * with on a device — which is the only way the right number gets found. **It is one line.**
 * Change it here and the server, the shop copy and every button label follow, because nothing
 * else names it.
 *
 * ## Own photograph and somebody else's cost the same
 *
 * A deliberate answer rather than an oversight. The obvious argument for charging more for a
 * stranger's is that you are spending a model call on a row that is not yours — but the call
 * costs us exactly the same either way, and a player cannot tell that "yours is cheaper" is
 * about our bill rather than about their standing. One price is a rule somebody can hold in
 * their head, and it is the only version that does not need explaining on a button.
 *
 * ## What it is calibrated against
 *
 * The grant cannot buy this — spending is wallet-only — so the budget is what a player has
 * been *given*, which is what makes generosity the way into the paid half of the product
 * rather than a dead end. Seven a week given away, if roughly reciprocated, is about two
 * extra reveals at this price.
 */
export const PAW_REVEAL_COST = 3;

/**
 * Whether a wallet covers a price.
 *
 * Trivial, and it is a named function rather than an inline `>=` for one reason: it is the
 * only place a spend is authorised, so it is the line to read when asking "can the grant pay
 * for this". It takes a **wallet balance**, not a total — the grant is not a parameter here
 * and cannot be passed by accident.
 *
 * A zero price is affordable by an empty wallet, which is what makes `pawPrice: 0` a legal way
 * to author a free item rather than an item nobody can ever claim.
 */
export function canAfford(walletBalance: number, cost: number): boolean {
  return Number.isFinite(cost) && cost >= 0 && walletBalance >= cost;
}

/* -------------------------------------------------------------------------- */
/* The grant period                                                           */
/* -------------------------------------------------------------------------- */

export interface GrantPeriod {
  /** ISO. The anchor `resetsAt` is measured from. */
  periodStart: string;
  remaining: number;
}

/**
 * Where a player's grant stands, settled to `now`.
 *
 * Lazy settlement, called on every read and every spend. Nothing in this codebase runs on a
 * schedule — the argument is at the top of `services/challenges.ts` and it applies unchanged
 * here: a weekly cron would have to touch every row at one instant, can be missed, and leaves
 * balances wrong for as long as the tick is late. Settling on read means the only row that
 * needs to be right is the one somebody is looking at.
 *
 * ## The anchor rolls by whole windows
 *
 * `periodStart` advances by however many complete windows have elapsed, never to `now`.
 * Setting it to now would drag the player's week later each time they were slow to open the
 * app — a grant that arrives at a different hour every week is one nobody can plan around,
 * and it would reward not opening the app with a permanently later reset.
 *
 * ## Nothing carries over
 *
 * `remaining` resets to the full grant regardless of how many periods passed or what was
 * left. Three weeks away is still seven paws, not twenty-one. The bucket that accumulates is
 * the wallet, and having two of those would make the wallet pointless.
 *
 * `null` is a player who has never had a row — their first period starts now, full.
 */
export function rollGrant(
  current: GrantPeriod | null,
  now: Date = new Date()
): GrantPeriod & { changed: boolean } {
  if (!current) {
    return { periodStart: now.toISOString(), remaining: PAW_GRANT, changed: true };
  }

  const started = Date.parse(current.periodStart);

  /*
   * An unparseable or future anchor is repaired rather than trusted.
   *
   * A future `period_start` would make `elapsed` negative and floor to a negative number of
   * windows, rolling the anchor *backwards* and handing out a grant on every single read.
   * The row cannot get into that state through this file, which is exactly why it is worth
   * a branch: if it ever does, the failure is silent and expensive.
   */
  if (!Number.isFinite(started) || started > now.getTime()) {
    return { periodStart: now.toISOString(), remaining: PAW_GRANT, changed: true };
  }

  const elapsed = now.getTime() - started;
  const periods = Math.floor(elapsed / PAW_GRANT_WINDOW_MS);

  if (periods < 1) {
    return { periodStart: current.periodStart, remaining: current.remaining, changed: false };
  }

  return {
    periodStart: new Date(started + periods * PAW_GRANT_WINDOW_MS).toISOString(),
    remaining: PAW_GRANT,
    changed: true,
  };
}

/** When the current grant expires and the next one lands. What the client counts down to. */
export function grantResetsAt(periodStart: string): string {
  return new Date(Date.parse(periodStart) + PAW_GRANT_WINDOW_MS).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Which pot a gift comes out of                                              */
/* -------------------------------------------------------------------------- */

/**
 * Grant first, always. `null` means there is nothing to give.
 *
 * The server decides this and the client never sends it. There is no toggle and no setting,
 * because there is no case where spending the wallet first is better for the player: grant
 * paws expire at the end of the period and wallet paws do not, so wallet-first is strictly
 * worse in every state the two can be in. A choice with one correct answer is not a choice,
 * it is a trap for whoever taps the wrong half — so the rule lives here, once.
 *
 * The client mirrors this to *word the gift toast* before the response lands ("6 left this
 * week" versus "from your wallet"). That is a prediction, and the server's answer overwrites
 * it — see `usePawGift`.
 */
export function chooseBucket(grantRemaining: number, walletBalance: number): PawBucket | null {
  if (grantRemaining > 0) return 'grant';
  if (walletBalance > 0) return 'wallet';
  return null;
}

/**
 * Whether this photograph may be given to at all, ignoring what the giver can afford.
 *
 * Two refusals, and they are separated from the balance check on purpose: these are facts
 * about the *photograph* and are the same for every caller, where an empty balance is a fact
 * about the caller and is answered by `chooseBucket` returning null.
 *
 *   `not_found`  — no such photo, or it is not shared. One answer for both, matching
 *                  `votablePhoto` in `services/votes.ts`: telling them apart confirms that an
 *                  id somebody guessed names a real private photograph.
 *   `own_photo`  — yours. Refused for **both** buckets. Tipping yourself moves a paw between
 *                  your own pockets, which costs nothing and puts a number under your
 *                  photograph that says other people liked it.
 */
export type GiftRefusal = 'not_found' | 'own_photo';

export function refuseGift(
  viewerId: string,
  photo: { ownerId: string; sharedToFeed: boolean } | null
): GiftRefusal | null {
  if (!photo || !photo.sharedToFeed) return 'not_found';
  if (photo.ownerId === viewerId) return 'own_photo';
  return null;
}

/* -------------------------------------------------------------------------- */
/* The ledger                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One movement, as the pure rules need to see it.
 *
 * Deliberately narrower than the row: `walletBalance` cares about bucket and delta and
 * nothing else. Keeping the shape small is what lets `scripts/check-paws.ts` build cases by
 * hand instead of assembling database rows. `reason` and `createdAt` are carried because a
 * balance you cannot explain is the thing the ledger exists to avoid — anything summing these
 * rows should be able to say *which* row it summed.
 */
export interface PawMovement {
  delta: number;
  reason: PawReason;
  bucket: PawBucket;
  createdAt: string;
}

/**
 * A wallet balance from the rows that make it up.
 *
 * Only `bucket: 'wallet'` counts. Grant spending writes a ledger row too — so the table is a
 * complete history of every paw that moved — but the grant's remaining balance lives on
 * `paw_grants.remaining`, and summing both here would double-count every gift drawn from it.
 *
 * Floored at zero. It cannot go negative through any path in `services/paws.ts`, and if it
 * ever did, showing a player a negative balance would be the second-worst way for them to
 * find out.
 */
export function walletBalance(rows: readonly PawMovement[]): number {
  const total = rows.reduce((sum, row) => (row.bucket === 'wallet' ? sum + row.delta : sum), 0);
  return Math.max(0, total);
}

/* -------------------------------------------------------------------------- */
/* The photo's counter                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `photos.paw_count` after a gift, or after a support reversal run by hand.
 *
 * ## Why this increments where `votes` recounts
 *
 * `services/votes.ts` recomputes `vote_count` from the rows every time, and argues — rightly
 * — that a counter which is only ever incremented drifts the first time anything goes wrong.
 * The same argument gives the opposite answer here, because the two counters count different
 * shapes of thing.
 *
 * A recount of votes is bounded by the audience: `votes_one_per_person` means one row per
 * viewer, so the work is small and stays small. Paws have no such cap by design, so a recount
 * would read every gift a photograph has ever received on every new one — unbounded work,
 * growing fastest on exactly the photographs that are doing best. That is the wrong place to
 * put a cost.
 *
 * So this is a cache, and the ledger is the authority. A drift here is a wrong number under a
 * photograph, recoverable at any time by counting the standing gifts in `paw_ledger`; the
 * ledger itself cannot drift, because nothing edits it.
 *
 * Floored, because the column carries `photos_paw_count_nonnegative` — a decrement against a
 * count that has somehow reached zero must clamp rather than turn a small display bug into a
 * failed write.
 */
export function nextPawCount(current: number, delta: number): number {
  return Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
}

/**
 * How many paws one tap gives.
 *
 * A constant rather than a parameter, and it should stay one until somebody has designed the
 * gesture that means "five". Every refusal message and every toast says "1 paw", and a
 * variable amount makes each of them a template with a plural rule in it.
 */
export const PAW_GIFT_SIZE = 1;
