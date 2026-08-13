/**
 * Challenge rules.
 *
 * Pure, so `scripts/check-challenges.ts` exercises all of it without a project — which matters
 * more here than usual, because two of these functions are about *dates*, and date arithmetic
 * that is only ever run against "now" is date arithmetic nobody has tested at a boundary.
 */

export type ChallengeStatus = 'upcoming' | 'active' | 'closed';
export type ChallengeJudging = 'score' | 'votes';

/**
 * Where a challenge is in its life, from its window alone.
 *
 * Derived rather than stored, which is the decision that means there is **no rotation job**.
 * A stored status is a column that has to be flipped by something running at the right minute,
 * and the failure mode is a challenge that stays "upcoming" for a day because a scheduler
 * missed a tick. Two timestamps and a comparison cannot miss a tick.
 *
 * The window is half-open at the end: a challenge whose `ends_at` is exactly now is closed.
 * Somebody submitting on the final second gets a refusal rather than an entry that may or may
 * not be counted depending on which server clock read the row.
 */
export function statusOf(startsAt: string, endsAt: string, now: Date = new Date()): ChallengeStatus {
  const t = now.getTime();

  if (t < new Date(startsAt).getTime()) return 'upcoming';
  if (t >= new Date(endsAt).getTime()) return 'closed';

  return 'active';
}

/* -------------------------------------------------------------------------- */
/* Picking a winner                                                           */
/* -------------------------------------------------------------------------- */

export interface Entrant {
  photoId: string;
  /** Null while the photograph has not been judged. */
  scoreTotal: number | null;
  communityScore: number;
  voteCount: number;
}

/**
 * The winning photograph, or null when there is nothing to award.
 *
 * `score` ranks on the model's number, which is what an objective prompt asked for — "a cat in
 * the last light of the day" has a right answer and the rubric is how it is measured.
 *
 * `votes` ranks on `community_score` rather than raw `vote_count`, because a raw count rewards
 * exposure: a photograph seen by four hundred people beats a better one seen by forty, and
 * ordering by the smoothed ratio is what stops a challenge being won by whoever posted at the
 * busiest hour. Every entry is shared to the feed on submission, so they are competing on
 * comparable terms.
 *
 * **An unscored photograph cannot win a `score` challenge.** It has no number, and treating a
 * null as a zero would silently rank it last while treating it as anything else would invent a
 * verdict nobody reached. It simply is not eligible for that ordering — which is fair, because
 * the player had the whole window to reveal it.
 */
export function pickWinner(entrants: readonly Entrant[], judging: ChallengeJudging): string | null {
  const eligible =
    judging === 'score' ? entrants.filter((e) => e.scoreTotal !== null) : [...entrants];

  if (eligible.length === 0) return null;

  const ranked = [...eligible].sort((a, b) => {
    if (judging === 'score') {
      const byScore = (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0);
      if (byScore !== 0) return byScore;
    } else {
      const byCommunity = b.communityScore - a.communityScore;
      if (byCommunity !== 0) return byCommunity;
    }

    /*
     * Ties broken on the other measure, then on raw reactions, then on the id.
     *
     * The last one is not arbitrary-looking for its own sake: without a total ordering the
     * winner of a tie depends on the order Postgres happened to return rows, which means a
     * settled challenge could name a different winner if it were ever re-settled. The id makes
     * the outcome a function of the entries and nothing else.
     */
    const byOther =
      judging === 'score'
        ? b.communityScore - a.communityScore
        : (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0);
    if (byOther !== 0) return byOther;

    const byVotes = b.voteCount - a.voteCount;
    if (byVotes !== 0) return byVotes;

    return a.photoId < b.photoId ? -1 : 1;
  });

  return ranked[0]!.photoId;
}

/* -------------------------------------------------------------------------- */
/* The streak                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Consecutive days ending today, in the player's captures.
 *
 * Counted back from today, and **yesterday is allowed to be the most recent day**. Somebody
 * who has not photographed a cat yet this morning has not broken a nine-day run, and telling
 * them they have — at breakfast, before they have had the chance — is the version of this
 * feature that makes people stop opening the app.
 *
 * A run that ended two days ago is over and reports zero.
 *
 * ## Days are UTC
 *
 * Deliberate, and the trade is stated rather than hidden: a player in UTC+13 gets their day
 * boundary at 11am local. The alternative is trusting a timezone off the device, which is a
 * value the player can change — and a streak is exactly the kind of number somebody would
 * change it for. A boundary in the wrong place is a smaller wrong than a boundary anybody can
 * move.
 */
export function captureStreak(capturedAt: readonly string[], now: Date = new Date()): number {
  if (capturedAt.length === 0) return 0;

  const days = new Set(capturedAt.map((iso) => iso.slice(0, 10)));

  const today = dayKey(now, 0);
  const yesterday = dayKey(now, 1);

  // Nothing today and nothing yesterday: whatever run there was has ended.
  if (!days.has(today) && !days.has(yesterday)) return 0;

  let streak = 0;
  for (let back = days.has(today) ? 0 : 1; ; back += 1) {
    if (!days.has(dayKey(now, back))) break;
    streak += 1;
  }

  return streak;
}

/** The UTC calendar day `back` days before `now`, as `YYYY-MM-DD`. */
function dayKey(now: Date, back: number): string {
  const d = new Date(now.getTime() - back * 86_400_000);
  return d.toISOString().slice(0, 10);
}
