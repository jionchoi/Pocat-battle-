/**
 * The rate-limit tiers: how much of each kind of request one caller may make.
 *
 * Here rather than in the middleware because there is no database under any of it, and
 * because these are the numbers somebody will want to change without reading Express — the
 * same reason `REVEAL_LIMITS` lives in `scoring.ts`. `middleware/rateLimit.ts` is the wiring
 * and holds no numbers of its own; `scripts/check-limits.ts` asserts the relationships
 * between them that the reasoning below depends on.
 *
 * ## What these are sized against
 *
 * Not fairness and not cost recovery. Every tier is set well above what a person using the
 * app can reach, so that the first caller to hit one is a script or a client stuck in a retry
 * loop. If a real player ever meets one of these, the number is wrong and should be raised
 * rather than defended.
 *
 * ## Why almost all of them are per player
 *
 * Phones sit behind carrier-grade NAT: tens of thousands of subscribers share a handful of
 * public addresses. An address-keyed limit tuned for one person locks out a city, and one
 * tuned so a city fits through it is not a limit. Only `flood` and `public` key on the
 * address, and both are about the pipe rather than about who is at the other end of it.
 */

export interface Tier {
  /** The window, in milliseconds. */
  windowMs: number;
  /** How many requests one key may make inside it. */
  limit: number;
  /** Shown to the player. Written for a person, and says nothing about how the limit works. */
  message: string;
  /** Address-keyed rather than player-keyed. True only where there is no player to key on. */
  byAddress?: true;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  /**
   * The outermost ceiling, and the only deliberately blunt one.
   *
   * It is not trying to be fair between players — carrier NAT makes that impossible at this
   * layer — it is making an unattended script stop being free before it reaches anything that
   * queries the database. Set high enough that a shared carrier address carrying real users
   * never approaches it.
   */
  flood: {
    windowMs: MINUTE,
    limit: 600,
    byAddress: true,
    message: 'Too many requests from your network. Wait a moment and try again.',
  },

  /**
   * The default for authenticated traffic.
   *
   * Sized for the noisiest honest thing the app does — opening the map, which pages sightings
   * while the player pans — with room left over.
   */
  read: {
    windowMs: MINUTE,
    limit: 120,
    message: 'You are going a little fast. Give it a few seconds.',
  },

  /**
   * Anything that writes a row somebody else can see: votes, captions, entries, identifications.
   *
   * The abuse this answers is volume of content rather than load — a script voting on every
   * photograph in the feed, or re-entering a challenge to churn its leaderboard.
   */
  write: {
    windowMs: MINUTE,
    limit: 30,
    message: 'That was a lot of changes at once. Give it a minute.',
  },

  /**
   * Captures and reveals — the two paths that end at a paid model call.
   *
   * This covers the gap the reveal ledger was never meant to. That ledger rations *successful*
   * scores at two a day for a free player, and a failed call costs the same as a successful
   * one while touching no allowance; `MAX_SCORING_ATTEMPTS` caps retries per photograph but
   * not a caller who simply uses a new photograph every time. An hour rather than a minute,
   * because what is being limited is a session's worth of intent rather than a burst.
   */
  costly: {
    windowMs: HOUR,
    limit: 120,
    message: 'You have taken a lot of photographs this hour. Try again shortly.',
  },

  /**
   * Reaching another person: friend requests, responses, and searching for who to send one to.
   *
   * The only tier about people rather than resources. An unlimited friend-request endpoint is
   * a harassment tool, and an unlimited prefix search enumerates the user table a couple of
   * letters at a time — `prefixPattern` refusing a bare `%` is the other half of that argument.
   */
  social: {
    windowMs: HOUR,
    limit: 60,
    message: 'That is a lot of requests to other players. Try again later.',
  },

  /**
   * Irreversible account actions.
   *
   * Deleting an account is the one call in this API with no undo, and there is no honest
   * reason to make it twice. Low enough to be conspicuous in a log.
   */
  danger: {
    windowMs: HOUR,
    limit: 5,
    message: 'Too many attempts. Wait an hour before trying again.',
  },

  /**
   * `GET /feed/viral`, the one route that answers an anonymous caller.
   *
   * Address-keyed because there is no player to key on. It takes an optional token precisely
   * so a CDN can cache one response for every anonymous reader, which makes this the limit
   * standing in front of the origin when that cache misses — so it is generous, since a shared
   * address may itself be a shared cache.
   */
  public: {
    windowMs: MINUTE,
    limit: 60,
    byAddress: true,
    message: 'Too many requests. Wait a moment and try again.',
  },
} as const satisfies Record<string, Tier>;

export type TierName = keyof typeof RATE_LIMITS;
