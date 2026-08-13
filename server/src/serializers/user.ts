/**
 * A player, as anybody else sees them.
 *
 * Deliberately small. `profiles` carries a real name, a home location, a push token and four
 * notification preferences, and **none of them appear here** — this is the file that decides
 * that, so a column added to the table does not become a column published to strangers by
 * default. The `Me` shape the client builds for its own account is assembled in
 * `src/lib/profile.ts` from a direct read, under RLS, and is a different thing.
 */

export interface ProfileRow {
  id: string;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  pro_subscription_active: boolean;
  /** PostgREST types a to-one embed as an array when it cannot prove the cardinality. */
  player_stats: { rank: number; xp: number }[] | { rank: number; xp: number } | null;
}

export function serializeUser(row: ProfileRow, friendIds: readonly string[]) {
  const stats = Array.isArray(row.player_stats) ? row.player_stats[0] : row.player_stats;

  return {
    id: row.id,

    /*
     * Empty rather than null when setup never finished.
     *
     * The client's `User.username` is a string, and a player with no name is a real state —
     * the row is created by the signup trigger before the setup screen runs. Nothing should be
     * able to reach a stranger's profile in that state, but a feed card whose author never
     * finished onboarding would otherwise crash the page rather than render one odd row.
     */
    username: row.username ?? '',
    avatarUrl: row.avatar_url ?? '',

    photographerRank: stats?.rank ?? 1,
    photographerXp: stats?.xp ?? 0,
    createdAt: row.created_at,

    /*
     * Only ever this player's *own* friends, and empty for anybody else.
     *
     * Who somebody is friends with is their business. The field exists because the client's
     * `User` type carries it, and it is filled in exactly one place — the caller's own
     * profile — rather than being quietly populated for every user in a search result.
     */
    friendIds: [...friendIds],

    proSubscriptionActive: row.pro_subscription_active,
  };
}
