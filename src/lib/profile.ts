import { supabase } from './supabase';
import { ALBUM_CONFIG, RANK_TIERS } from '../constants/game';
import type { Me } from '../models';

/**
 * Reading a player's own identity.
 *
 * This talks to Postgres directly rather than through our API, and that is deliberate
 * rather than a shortcut. Row level security already answers the only question a read of
 * this kind asks — may you see this row — and putting our own server in front of it would
 * add a hop, a second place for the shape to drift, and no security whatsoever.
 *
 * Writes are the opposite. Anything that decides a score goes through the API, because a
 * policy can say which rows you may write but not what a photograph is worth. The split is
 * visible in the schema: `profiles` has an update policy, `player_stats` has none.
 */

/**
 * Signed in, but there is no profile row to read.
 *
 * Distinct from a network failure, and the distinction decides where the player lands: a
 * missing row means setup has not happened, and they belong on the setup screen. A failed
 * request means we do not know, and an established account must not be dropped into setup
 * because a fetch timed out.
 *
 * It should be unreachable in normal use — the signup trigger creates the row inside the
 * same transaction as the account. It happens when that trigger is not installed, which is
 * exactly the case worth naming rather than swallowing.
 */
export class ProfileMissingError extends Error {
  constructor() {
    super('No profile row for this account.');
    this.name = 'ProfileMissingError';
  }
}

/** The two tables that exist so far, joined in one round trip. */
const SELECT = `
  id,
  username,
  firstname,
  lastname,
  avatar_url,
  pro_subscription_active,
  created_at,
  player_stats ( rank, xp, best_score, likes_received )
`;

interface ProfileRow {
  id: string;
  username: string | null;
  firstname: string | null;
  lastname: string | null;
  avatar_url: string | null;
  pro_subscription_active: boolean;
  created_at: string;
  /*
   * PostgREST returns an embedded to-one relation as an object and a to-many as an array,
   * and which one it decides this is depends on it recognising `player_stats.user_id` as
   * both a primary key and a foreign key. Accepting either shape costs one line and
   * removes a whole class of "it worked in the SQL editor" surprise.
   */
  player_stats: PlayerStatsRow | PlayerStatsRow[] | null;
}

interface PlayerStatsRow {
  rank: number;
  xp: number;
  best_score: number;
  likes_received: number;
}

/**
 * Fetches the signed-in player, shaped as the `Me` every screen already reads.
 *
 * ## About the zeroes
 *
 * `photoCount`, `catsDiscovered` and `lifetimeScore` are counted from tables that do not
 * exist yet. They are zero here rather than absent because the alternative is making them
 * optional on `Me` and teaching every screen to render a maybe-number. When the photo and
 * dex tables land, this function grows the counts and nothing above it changes.
 *
 * They are deliberately *not* faked from what is available — `best_score` is the highest
 * single score and `lifetimeScore` is the sum of every score, and quietly showing one as
 * the other would be a number that looks right and is wrong.
 */
export async function fetchMe(userId: string, email: string | null): Promise<Me> {
  const { data, error } = await supabase
    .from('profiles')
    .select(SELECT)
    .eq('id', userId)
    .single<ProfileRow>();

  // PGRST116 is PostgREST's "expected one row, got none" from `.single()`.
  if (error?.code === 'PGRST116') throw new ProfileMissingError();
  if (error) throw error;

  const stats = Array.isArray(data.player_stats)
    ? (data.player_stats[0] ?? null)
    : data.player_stats;

  const rank = stats?.rank ?? 1;
  const xp = stats?.xp ?? 0;

  return {
    id: data.id,
    /*
     * Null becomes an empty string on the way in. `Me.username` is a plain string across
     * every screen that renders it, and the app never shows an unset one anyway — a player
     * without a username is held on the setup screen. Widening the model to `string | null`
     * would push a null check into a dozen components to describe a state none of them can
     * reach.
     */
    username: data.username ?? '',
    avatarUrl: data.avatar_url ?? '',
    photographerRank: rank,
    photographerXp: xp,
    createdAt: data.created_at,
    proSubscriptionActive: data.pro_subscription_active,

    email,
    votesReceived: stats?.likes_received ?? 0,
    xpToNextRank: xpToNextRank(xp, rank),
    photoLimit: data.pro_subscription_active ? null : ALBUM_CONFIG.freePhotoLimit,

    // Counted from tables that do not exist yet. See the note above.
    friendIds: [],
    lifetimeScore: 0,
    photoCount: 0,
    catsDiscovered: 0,
  };
}

/**
 * Sets the username and avatar chosen during onboarding.
 *
 * Straight to the table, under the "players can update their own profile" policy — the
 * database enforces that you are editing yourself, so there is nothing for an API to check.
 * A duplicate name comes back as a unique-violation from the index on `lower(username)`,
 * which is the only place that check can be raceless.
 */
export async function saveOnboarding(params: {
  userId: string;
  username: string;
  avatarUrl?: string;
}): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      username: params.username,
      ...(params.avatarUrl ? { avatar_url: params.avatarUrl } : {}),
    })
    .eq('id', params.userId)
    // Selecting back is what makes a no-op detectable. An UPDATE that matches no rows —
    // because the row is missing, or because a policy hid it — is a success with a count
    // of zero, and without this the setup screen would congratulate the player and send
    // them into an app that still has no profile.
    .select('id');

  if (error) {
    // 23505 is Postgres' unique violation. Everything else is unexpected and says so.
    if (error.code === '23505') {
      throw new Error('That username is taken. Try another.');
    }
    throw error;
  }

  if (!data || data.length === 0) throw new ProfileMissingError();
}

/** XP still to earn before the next rank. Zero at the top of the ramp. */
function xpToNextRank(xp: number, rank: number): number {
  const next = RANK_TIERS.find((tier) => tier.rank === rank + 1);
  if (!next) return 0;
  return Math.max(0, next.xpRequired - xp);
}
