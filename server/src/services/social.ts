import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { publicUrlFor } from '../lib/storage.js';
import { prefixPattern } from '../lib/search.js';
import { serializeUser, type ProfileRow } from '../serializers/user.js';
import { serializePhoto, type PhotoRow } from '../serializers/photo.js';
import { friendIdsOf, profilesFor } from './friends.js';
import { nicknamesFor } from './catNames.js';
import { challengeWins } from './challenges.js';

/**
 * Leaderboards, search, and somebody else's profile.
 *
 * The read side of the social layer. Everything here answers questions about *other people*,
 * which is why every one of them goes through `serializers/user.ts` rather than selecting
 * `profiles.*` — that file is where the decision about what a stranger may see is kept.
 */

export type LeaderboardScope = 'neighborhood' | 'city' | 'global' | 'friends';
export type LeaderboardMetric = 'community' | 'votesReceived' | 'challengeWins' | 'topPhoto';

const BOARD_LIMIT_MAX = 100;

/* -------------------------------------------------------------------------- */
/* The leaderboard                                                            */
/* -------------------------------------------------------------------------- */

export async function leaderboard(
  viewerId: string,
  params: { scope: LeaderboardScope; metric: LeaderboardMetric; limit?: number }
) {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), BOARD_LIMIT_MAX);

  /*
   * Neighbourhood and city answer an empty snapshot, not an error and not global.
   *
   * There is no geocoding, so there is no name to put in `bucket` — and a leaderboard labelled
   * with a coordinate is not a place anybody recognises. The client models exactly this: both
   * `bucket` and `computedAt` are nullable and the hub already draws "not computed for this
   * neighbourhood yet". Falling back to global would be worse than empty, because it would
   * silently show a player a board they are not on and call it their neighbourhood.
   *
   * `profiles.home_lat/lng` now exist, so the missing piece is a way to name an area rather
   * than a way to find one.
   */
  if (params.scope === 'neighborhood' || params.scope === 'city') {
    return { entries: [], bucket: null, computedAt: null };
  }

  const candidateIds =
    params.scope === 'friends' ? [...(await friendIdsOf(viewerId)), viewerId] : null;

  // A friends board with no friends is the player alone, which is a real and slightly sad
  // answer rather than an error.
  const ranked = await rankedPlayers(params.metric, candidateIds, limit);

  const profiles = await profilesFor(ranked.map((row) => row.userId));

  return {
    entries: ranked.map((row, index) => {
      const profile = profiles.get(row.userId);

      return {
        rank: index + 1,
        userId: row.userId,
        username: profile?.username ?? '',
        avatarUrl: profile?.avatar_url ?? '',
        value: row.value,
        isSelf: row.userId === viewerId,
        topPhotoUrl: row.topPhotoPath ? publicUrlFor(row.topPhotoPath) : null,
      };
    }),
    bucket: params.scope === 'friends' ? 'Friends' : 'Everyone',
    computedAt: new Date().toISOString(),
  };
}

interface RankedPlayer {
  userId: string;
  value: number;
  /** The photograph that earned the position, when the metric has one. */
  topPhotoPath: string | null;
}

/**
 * The ordering, per metric.
 *
 * Computed live rather than from a snapshot table. That is the right trade at this size and
 * the wrong one later: a board over every player is a sort over `player_stats`, which is one
 * row per account, and it stops being cheap somewhere in the hundreds of thousands. The
 * response already carries `computedAt` so a snapshot can be introduced without the client
 * changing — which is why that field exists rather than being dropped as always-now.
 */
async function rankedPlayers(
  metric: LeaderboardMetric,
  candidateIds: string[] | null,
  limit: number
): Promise<RankedPlayer[]> {
  if (candidateIds !== null && candidateIds.length === 0) return [];

  if (metric === 'challengeWins') return rankByChallengeWins(candidateIds, limit);
  if (metric === 'community') return rankByBestCommunityPhoto(candidateIds, limit);

  // `topPhoto` is the app's own opinion, `votesReceived` is the crowd's. Both live on
  // player_stats, which is why they share a path.
  const column = metric === 'topPhoto' ? 'best_score' : 'likes_received';

  let builder = supabase
    .from('player_stats')
    .select('user_id, best_score, likes_received')
    .order(column, { ascending: false })
    .limit(limit);

  if (candidateIds) builder = builder.in('user_id', candidateIds);

  const { data, error } = await builder;
  if (error) throw error;

  const rows = (data ?? []) as {
    user_id: string;
    best_score: number;
    likes_received: number;
  }[];

  const tops = await topPhotoPaths(rows.map((row) => row.user_id));

  return rows.map((row) => ({
    userId: row.user_id,
    value: metric === 'topPhoto' ? row.best_score : row.likes_received,
    topPhotoPath: tops.get(row.user_id) ?? null,
  }));
}

/**
 * Ranked by each player's single best-received photograph.
 *
 * Their best, not their average: a board over averages punishes anybody who posts often, which
 * is the opposite of what a feed wants to encourage. Only shared photos count, because an
 * unshared one has had no chance to be judged.
 */
async function rankByBestCommunityPhoto(
  candidateIds: string[] | null,
  limit: number
): Promise<RankedPlayer[]> {
  let builder = supabase
    .from('photos')
    .select('owner_id, community_score, storage_path')
    .eq('shared_to_feed', true)
    .order('community_score', { ascending: false })
    // Over-fetch, because many rows will belong to the same handful of people and the top N
    // photographs are not the top N players.
    .limit(limit * 10);

  if (candidateIds) builder = builder.in('owner_id', candidateIds);

  const { data, error } = await builder;
  if (error) throw error;

  const best = new Map<string, RankedPlayer>();

  for (const row of (data ?? []) as {
    owner_id: string;
    community_score: number | null;
    storage_path: string;
  }[]) {
    if (best.has(row.owner_id)) continue;

    best.set(row.owner_id, {
      userId: row.owner_id,
      value: row.community_score ?? 0,
      topPhotoPath: row.storage_path,
    });
  }

  return [...best.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

/** Ranked by challenges won. `topPhotoUrl` is null here — a win is not one photograph. */
async function rankByChallengeWins(
  candidateIds: string[] | null,
  limit: number
): Promise<RankedPlayer[]> {
  const { data, error } = await supabase
    .from('challenges')
    .select('winning_photo_id')
    .not('winning_photo_id', 'is', null);

  if (error) throw error;

  const photoIds = (data ?? []).map((row) => row.winning_photo_id as string);
  if (photoIds.length === 0) return [];

  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('id, owner_id')
    .in('id', photoIds);

  if (photosError) throw photosError;

  const wins = new Map<string, number>();

  for (const row of (photos ?? []) as { owner_id: string }[]) {
    if (candidateIds && !candidateIds.includes(row.owner_id)) continue;
    wins.set(row.owner_id, (wins.get(row.owner_id) ?? 0) + 1);
  }

  return [...wins.entries()]
    .map(([userId, value]) => ({ userId, value, topPhotoPath: null }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Each player's highest-scoring shared photograph, for the row thumbnail. */
async function topPhotoPaths(userIds: readonly string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('photos')
    .select('owner_id, storage_path, score_total')
    .in('owner_id', [...userIds])
    .eq('shared_to_feed', true)
    .not('scored_at', 'is', null)
    .order('score_total', { ascending: false });

  if (error) throw error;

  const map = new Map<string, string>();

  for (const row of (data ?? []) as { owner_id: string; storage_path: string }[]) {
    if (!map.has(row.owner_id)) map.set(row.owner_id, row.storage_path);
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Finds players by name.
 *
 * Prefix-anchored rather than a contains match, and that is a privacy decision rather than an
 * index one: `%oe%` would let somebody enumerate the user table a couple of letters at a time,
 * where `oe%` only answers people who are looking for a name they already partly know.
 *
 * Accounts that never finished onboarding have no username and cannot be found at all, which
 * falls out of the null check rather than needing a rule.
 */
export async function searchUsers(viewerId: string, term: string) {
  const query = term.trim();
  if (query.length < 2) return { users: [] };

  // Prefix-anchored, and escaped so a player typing `%` or `_` means the character. See
  // lib/search.ts for why the escape is shared and the wildcards are not.
  const pattern = prefixPattern(query);

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, created_at, pro_subscription_active, player_stats ( rank, xp )')
    .ilike('username', pattern)
    .not('username', 'is', null)
    .neq('id', viewerId)
    .limit(20);

  if (error) throw error;

  return { users: ((data ?? []) as ProfileRow[]).map((row) => serializeUser(row, [])) };
}

/* -------------------------------------------------------------------------- */
/* Somebody else's profile                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A public profile.
 *
 * Every count here is over **shared photographs only**, and that is the whole design rather
 * than a filter that happens to be applied. `sharedToFeed` is the public/private line and it
 * is the player's own switch — counting the full album would leak how much they keep private,
 * which is exactly the number they decided not to share.
 */
export async function publicProfile(viewerId: string, userId: string) {
  const profiles = await profilesFor([userId]);
  const profile = profiles.get(userId);

  if (!profile || !profile.username) {
    throw new HttpError(404, 'We could not find that player.');
  }

  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('owner_id', userId)
    .eq('shared_to_feed', true);

  if (error) throw error;

  const shared = (data ?? []) as PhotoRow[];

  const tierCounts = { Common: 0, Rare: 0, Epic: 0, Legendary: 0 };
  let bestScore = 0;

  for (const row of shared) {
    if (row.scored_at) {
      const tier = (row.tier ?? 'Common') as keyof typeof tierCounts;
      if (tier in tierCounts) tierCounts[tier] += 1;
      bestScore = Math.max(bestScore, row.score_total ?? 0);
    }
  }

  const showcase = shared
    .filter((row) => row.showcased)
    .sort((a, b) => (b.score_total ?? 0) - (a.score_total ?? 0));

  const names = await nicknamesFor(
    viewerId,
    showcase.map((row) => row.cat_id).filter((id): id is string => id !== null)
  );

  const [catsDiscovered, challengeTrophies] = await Promise.all([
    countDiscovered(userId),
    challengeWins(userId),
  ]);

  return {
    // A stranger's friend list is not a stranger's business — see the serializer's note.
    user: serializeUser(profile, viewerId === userId ? await friendIdsOf(userId) : []),
    showcasePhotos: showcase.map((row) =>
      serializePhoto(row, row.cat_id ? (names.get(row.cat_id) ?? null) : null)
    ),
    tierCounts,
    // Public photos, not the album total: how much is kept private is itself private.
    totalPhotos: shared.length,
    catsDiscovered,
    bestScore,
    /*
     * The count and the wins come from one query now, so the rail and the trophy case under
     * it cannot disagree. They could before: the count came from its own `head: true` count
     * over the same rows, and a photograph deleted between the two reads left the rail
     * saying "3 wins" above two tiles.
     */
    challengeWins: challengeTrophies.length,
    challengeTrophies,
  };
}

/** Cats this player was the first to record. `discovered_by` is the whole answer. */
async function countDiscovered(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('cats')
    .select('id', { count: 'exact', head: true })
    .eq('discovered_by', userId);

  if (error) throw error;

  return count ?? 0;
}

