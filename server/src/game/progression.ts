/**
 * Photographer Rank — the ramp, and what a photograph is worth on it.
 *
 * Pure arithmetic with no database under it, which is why it lives here: every rule in this
 * file can be exercised without a Supabase project, and `scripts/check-progression.ts` does.
 *
 * ## Cosmetic progression, never power
 *
 * Rank changes a title and a meter and nothing else. It does not raise the reveal allowance,
 * does not enlarge the album, and does not weight a score. That is a product rule rather than
 * an omission — a game where the people who have played longest also score higher has stopped
 * being about the photographs.
 *
 * ## The ramp is mirrored, not shared
 *
 * `RANK_TIERS` below is a copy of the client's `src/constants/game.ts`. Two copies of a
 * constant is a thing to be uncomfortable about, and it is still right here: the client needs
 * the ramp to draw a meter offline, the server needs it to decide what to write, and the only
 * ways to have one copy are to ship the server's to the client at runtime — a request to
 * render a progress bar — or to build a shared package for twelve rows of data.
 *
 * **If you edit one, edit the other.** The server's is authoritative; a client that disagrees
 * draws a wrong meter until its next refresh, and `player_stats.rank` stays correct throughout.
 */

export interface RankTier {
  rank: number;
  title: string;
  xpRequired: number;
}

export const RANK_TIERS: readonly RankTier[] = [
  { rank: 1, title: 'Newcomer', xpRequired: 0 },
  { rank: 2, title: 'Stray Spotter', xpRequired: 250 },
  { rank: 3, title: 'Alley Regular', xpRequired: 700 },
  { rank: 4, title: 'Fence Sitter', xpRequired: 1_500 },
  { rank: 5, title: 'Window Watcher', xpRequired: 2_800 },
  { rank: 6, title: 'Sunbeam Tracker', xpRequired: 4_800 },
  { rank: 7, title: 'Rooftop Regular', xpRequired: 7_600 },
  { rank: 8, title: 'Night Prowler', xpRequired: 11_500 },
  { rank: 9, title: 'Whisker Whisperer', xpRequired: 16_800 },
  { rank: 10, title: 'Neighborhood Fixture', xpRequired: 23_800 },
  { rank: 11, title: 'Cat Cartographer', xpRequired: 33_000 },
  { rank: 12, title: 'Loaf Laureate', xpRequired: 45_000 },
];

/* -------------------------------------------------------------------------- */
/* What a photograph earns                                                    */
/* -------------------------------------------------------------------------- */

/**
 * XP for a scored photograph. **Yours to edit** — this is a game-design number, like the
 * rubric in `scoring.ts`, and it is deliberately the only place one appears.
 *
 * It is the score itself, one for one. Two other shapes were considered and both are worse:
 *
 *   a flat amount per capture — makes rank a measure of how often somebody opened the app,
 *   which the reveal allowance already rations, so the ramp would just be a clock;
 *
 *   a curve that pays disproportionately for high scores — compounds an opinion the model
 *   already expressed once, and a player who cannot reach 90 would watch the ramp stretch
 *   away from them for reasons they cannot act on.
 *
 * One for one keeps the sentence short: a better photograph is worth more, by exactly how
 * much better it is. At two reveals a day and scores in the fifties, rank 2 lands in about
 * three days, which is the pacing the tiers were written for.
 *
 * A total above 100 is expected — see the scoring notes — so this has no ceiling either.
 * Negative and fractional are both refused rather than clamped: the caller is handing over a
 * score that came off a row, and either of those means something upstream is broken in a way
 * that silently rounding would hide.
 */
export function xpForScore(scoreTotal: number): number {
  if (!Number.isFinite(scoreTotal) || scoreTotal < 0) return 0;
  return Math.round(scoreTotal);
}

/**
 * How much more XP a reveal is worth when the photograph is somebody else's.
 *
 * ## Both people are paid, and the one who spent gets more
 *
 * A paid reveal credits two accounts. The **photographer** gets exactly what they would have
 * got revealing it themselves — the score's XP and, if it beats their record, the best score.
 * Nothing is taken from them by somebody else pressing the button; from their side it is
 * indistinguishable from having revealed it, except that it was free.
 *
 * The **unlocker** gets this multiple of the same figure. More than the photographer, and more
 * than they would earn revealing one of their own, because unlocking somebody else's is the
 * act being encouraged and it is the only one of the two that costs paws. A reveal you paid
 * for that paid you the same as a free one would be a button nobody presses twice.
 *
 * ## This number is not settled
 *
 * A placeholder with a real value in it, like `PAW_REVEAL_COST` beside it in `game/paws.ts`.
 * **It is one line.** What it trades: raise it and buying reveals becomes the fastest way to
 * rank, which makes generosity the route to progression and also makes rank partly a measure
 * of spending; lower it toward 1 and the bonus stops being a reason to do it at all.
 *
 * The brake on the obvious abuse is not this number. Paws for spending come only from being
 * *given* them — the weekly grant cannot be spent — so farming XP this way requires other
 * people to have chosen to give you paws first, and there is no way to buy your way in.
 */
export const FOREIGN_REVEAL_XP_MULTIPLIER = 2;

/**
 * XP for revealing a photograph that is not yours.
 *
 * Rounded once, at the end, so the multiplier cannot introduce a fraction into a column that
 * holds whole numbers. Shares `xpForScore`'s refusals rather than restating them: a broken
 * score is worth nothing, whoever is being paid for it.
 */
export function xpForRevealingAnother(scoreTotal: number): number {
  return Math.round(xpForScore(scoreTotal) * FOREIGN_REVEAL_XP_MULTIPLIER);
}

/* -------------------------------------------------------------------------- */
/* The ramp                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The rank a given XP total has earned.
 *
 * The highest tier whose threshold has been reached, so it never falls: XP only goes up, and
 * a player who somehow arrived at a rank above what their XP supports keeps it. Demoting
 * somebody because a threshold was retuned is the one change to this file that would be felt
 * as a punishment.
 */
export function rankForXp(xp: number): number {
  let rank = RANK_TIERS[0]!.rank;

  for (const tier of RANK_TIERS) {
    if (xp >= tier.xpRequired) rank = tier.rank;
    else break;
  }

  return rank;
}

export function rankTitle(rank: number): string {
  return RANK_TIERS.find((tier) => tier.rank === rank)?.title ?? RANK_TIERS[0]!.title;
}

/** XP still to earn before the next tier. Zero at the top of the ramp, where there is none. */
export function xpToNextRank(xp: number, rank: number): number {
  const next = RANK_TIERS.find((tier) => tier.rank === rank + 1);
  if (!next) return 0;

  return Math.max(0, next.xpRequired - xp);
}
