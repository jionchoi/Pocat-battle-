/**
 * The community layer's arithmetic.
 *
 * The second scoring system. `scoring.ts` decides what the app thinks of a photograph;
 * this decides what people think of it, and the two are allowed to disagree loudly — a photo
 * the model rated modestly that players loved is the "this blew up" moment the product is
 * built around, and it only exists because the numbers are computed separately.
 *
 * Pure, so `scripts/check-community.ts` exercises all of it with no project.
 */

/**
 * The scale `community_score` is stored on, mirroring `COMMUNITY_CONFIG.scoreScale` in the
 * client. A ratio times a thousand, so the column stays an integer and the client divides.
 *
 * **If you change one, change the other** — the checks assert they agree.
 */
export const SCORE_SCALE = 1000;

/** The three reactions. Mirrors the client's `Reaction` and the column's check constraint. */
export type Reaction = 'laugh' | 'love' | 'wow';

export const REACTIONS: readonly Reaction[] = ['laugh', 'love', 'wow'];

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && (REACTIONS as readonly string[]).includes(value);
}

/** A zeroed tally, so a photo with no reactions still answers the shape the client expects. */
export function emptyReactions(): Record<Reaction, number> {
  return { laugh: 0, love: 0, wow: 0 };
}

/**
 * Unique viewers below which the client draws the score as provisional rather than as a
 * percentage. Mirrors `COMMUNITY_CONFIG.minViewsForConfidence`.
 *
 * The server does not hide the number — it returns the smoothed value either way — because
 * hiding it would mean the ordering and the label disagreed about what a photo is worth.
 * Presentation is the client's decision and this constant exists here to be checked against.
 */
export const MIN_VIEWS_FOR_CONFIDENCE = 10;

/**
 * How many reactions one person may leave in a rolling day.
 *
 * Mirrors `COMMUNITY_CONFIG.maxVotesPerDay`. It is not a spend guard — reactions cost
 * nothing — it is a brigading guard: without it one account can walk a friend up the
 * leaderboard, or walk a stranger's work down by mass-reacting to everyone else.
 */
export const MAX_VOTES_PER_DAY = 30;

/* -------------------------------------------------------------------------- */
/* The smoothed ratio                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The engagement ratio assumed for a photograph nobody has judged yet.
 *
 * Not zero, and that matters: a prior of zero would mean every new photo starts at the bottom
 * and has to climb out, which is exactly the cold-start problem that makes a young feed feel
 * dead. Eight percent is a plausible reactions-per-viewer rate, so a fresh photo enters the
 * ordering in the middle of the pack and moves from there.
 */
export const PRIOR_RATIO = 0.08;

/**
 * How much the prior is worth, in imaginary viewers.
 *
 * The number of real views it takes before the evidence outweighs the assumption — at ten,
 * a photo with ten views is scored half on what happened and half on the prior. Deliberately
 * equal to `MIN_VIEWS_FOR_CONFIDENCE`, so the point where the client starts showing a
 * percentage is the same point where that percentage is mostly about the photograph.
 */
export const PRIOR_WEIGHT = 10;

/**
 * The community's verdict on a photograph, 0..1000.
 *
 * A raw `votes / views` is the obvious thing and it is unusable: one viewer and one reaction
 * is 100%, which would put every photograph seen by exactly one enthusiastic friend above
 * everything on the platform. Smoothing pulls a small sample toward the prior in proportion
 * to how small it is, so a 1-of-1 lands near the assumption and a 90-of-1000 lands near 90%.
 *
 *   (votes + PRIOR_WEIGHT × PRIOR_RATIO) / (views + PRIOR_WEIGHT)
 *
 * Clamped at both ends. The top matters because impressions are best-effort — the client
 * batches them and flushes on unmount, so a dropped batch can leave a photo with more
 * reactions than recorded viewers, and an unclamped ratio above 1 would be a score no honest
 * photograph could reach.
 */
export function communityScore(voteCount: number, viewCount: number): number {
  const votes = Math.max(0, voteCount);
  const views = Math.max(0, viewCount);

  const ratio = (votes + PRIOR_WEIGHT * PRIOR_RATIO) / (views + PRIOR_WEIGHT);

  return Math.round(Math.min(1, Math.max(0, ratio)) * SCORE_SCALE);
}

/* -------------------------------------------------------------------------- */
/* The ranked feed                                                            */
/* -------------------------------------------------------------------------- */

export type ViralWindow = 'today' | 'week' | 'all';

const WINDOW_HOURS: Record<ViralWindow, number | null> = {
  today: 24,
  week: 24 * 7,
  all: null,
};

/** The oldest `created_at` a window admits, or null for all time. */
export function windowCutoff(window: ViralWindow, now: Date = new Date()): string | null {
  const hours = WINDOW_HOURS[window];
  return hours === null ? null : new Date(now.getTime() - hours * 3600_000).toISOString();
}

/**
 * The next window out, or null at the widest.
 *
 * The ranked feed widens rather than showing an empty page. A new install opening "today" in a
 * product with fifty users would otherwise see nothing at all, which reads as broken software
 * rather than as a quiet day — and the response carries the window it actually used, so the
 * client can say which one it is looking at instead of silently lying about "today".
 */
export function widerWindow(window: ViralWindow): ViralWindow | null {
  if (window === 'today') return 'week';
  if (window === 'week') return 'all';
  return null;
}

/**
 * How many photographs a window has to yield before it is worth showing on its own.
 *
 * Below this the page widens. One row is not a feed; it is an empty state with a picture on it.
 */
export const MIN_VIRAL_ROWS = 6;

/** How many of the ranked page are the top rail rather than the wall below it. */
export const TRENDING_COUNT = 3;

/**
 * Feed page sizes.
 *
 * Larger than the album's twenty, because a feed card is a whole photograph a reader scrolls
 * through in a second or two where an album tile is a thumbnail they scan. Mirrors
 * `FEED_CONFIG.pageSize` in the client.
 */
export const FEED_PAGE_SIZE = 20;
export const FEED_PAGE_SIZE_MAX = 50;
