import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { coarsenTo, HOME_GRID_M } from '../game/map.js';

/**
 * Account settings, and deleting an account.
 *
 * Everything here writes columns the app deliberately does **not** hold write access to. The
 * 2026-08-13 migration narrows the profile update grant to the four fields the setup screen
 * writes, so a push token, a home location and the notification preferences can only be set
 * through this file — which is the point: they are settings, not profile content, and one of
 * them is the most sensitive value in the schema.
 */

export interface NotificationPreferences {
  shareCapturesByDefault: boolean;
  pushChallengeResults: boolean;
  pushVotes: boolean;
  pushNearbyRareCats: boolean;
}

const PREFERENCE_COLUMNS = {
  shareCapturesByDefault: 'share_captures_by_default',
  pushChallengeResults: 'push_challenge_results',
  pushVotes: 'push_votes',
  pushNearbyRareCats: 'push_nearby_rare_cats',
} as const;

export async function getPreferences(userId: string): Promise<{ preferences: NotificationPreferences }> {
  const { data, error } = await supabase
    .from('profiles')
    .select(Object.values(PREFERENCE_COLUMNS).join(', '))
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'We could not find your profile.');

  const row = data as unknown as Record<string, boolean>;

  return {
    preferences: {
      shareCapturesByDefault: row['share_captures_by_default'] ?? true,
      pushChallengeResults: row['push_challenge_results'] ?? true,
      pushVotes: row['push_votes'] ?? true,
      pushNearbyRareCats: row['push_nearby_rare_cats'] ?? false,
    },
  };
}

/**
 * A partial update — a PATCH carries what changed and nothing else.
 *
 * An absent key must leave a preference alone rather than resetting it to a default, which is
 * the bug a naive `{...defaults, ...patch}` would introduce: a settings screen that saves one
 * toggle would quietly re-enable the three the player had turned off.
 */
export async function setPreferences(
  userId: string,
  patch: Partial<NotificationPreferences>
): Promise<{ preferences: NotificationPreferences }> {
  const changes: Record<string, boolean> = {};

  for (const [key, column] of Object.entries(PREFERENCE_COLUMNS)) {
    const value = patch[key as keyof NotificationPreferences];
    if (value !== undefined) changes[column] = value;
  }

  if (Object.keys(changes).length > 0) {
    const { error } = await supabase.from('profiles').update(changes).eq('id', userId);
    if (error) throw error;
  }

  return getPreferences(userId);
}

/* -------------------------------------------------------------------------- */
/* Push and place                                                             */
/* -------------------------------------------------------------------------- */

export async function setPushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ push_token: token })
    .eq('id', userId);

  if (error) throw error;
}

/**
 * Where the player lives, roughly.
 *
 * Stored and **never served back** — not to the player, not to their friends, not on any
 * profile. Nothing serializes these columns, which is why there is no `getHomeLocation`: the
 * only reads are internal, for the map's auto-suppression and the neighbourhood scope.
 *
 * A home address is the single most sensitive value in this schema. It is worth the asymmetry
 * of a setting you can write and not read back, because the alternative is an endpoint whose
 * whole purpose is to hand somebody's address to whoever holds their session.
 *
 * ## Coarsened here, not by the caller
 *
 * The exact pair never reaches the column. `MapScreen` sends a raw GPS fix and its comment has
 * always told the player "the server rounds it to a ~1km cell" — which was simply not true
 * until this line existed, so full-precision positions were being written to the most sensitive
 * column in the schema.
 *
 * It is done on this side deliberately. A client that coarsens before sending is a client that
 * can stop, and this endpoint accepts whatever it is given; snapping here makes the guarantee a
 * property of the column rather than of every caller remembering. Both uses want a cell anyway
 * — "is this capture near home" and "which neighbourhood is this" are both questions about an
 * area — so nothing downstream loses anything it was using.
 */
export async function setHomeLocation(
  userId: string,
  location: { lat: number; lng: number }
): Promise<void> {
  const home = coarsenTo(location.lat, location.lng, HOME_GRID_M);

  const { error } = await supabase
    .from('profiles')
    .update({ home_lat: home.lat, home_lng: home.lng })
    .eq('id', userId);

  if (error) throw error;
}

/* -------------------------------------------------------------------------- */
/* Deleting an account                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Removes the account itself.
 *
 * **The one auth action the app cannot perform.** Everything else — signing up, signing in,
 * refreshing, signing out — is the platform's job and the client talks to Supabase directly.
 * Deleting from `auth.users` needs the admin API, which needs the service-role key, which
 * cannot ship in a bundle. So it comes here.
 *
 * ## What goes, and in what order
 *
 * The storage objects first, then the auth user. The cascade from `auth.users` takes the
 * profile, and from there `player_stats`, `photos`, `cat_dex_entries`, `reveals`, `votes`,
 * `photo_views`, `friendships` and `challenge_entries` — every one of those was declared with
 * the cascade that makes this a single delete.
 *
 * Bucket objects are **not** in that cascade, because storage is not a foreign key. Deleting
 * the rows first would leave every photograph the player ever took in the bucket with nothing
 * pointing at it, and no way left to find it — the paths are keyed on a user id that no longer
 * resolves. So the objects go first, and a failure there stops the whole thing rather than
 * proceeding to orphan them.
 *
 * `cats` survives, and should: `discovered_by` is ON DELETE SET NULL precisely so that
 * deleting an account does not delete an animal out of every other player's Dex.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('owner_id', userId);

  if (error) throw error;

  const paths = (data ?? []).map((row) => row.storage_path as string);

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('cat-photos').remove(paths);

    if (storageError) {
      /*
       * Refused rather than carried on with.
       *
       * Leaving the photographs behind while removing the only record of who they belong to
       * is the worst outcome available here: the bucket is public, the paths stay reachable to
       * anybody holding a URL, and nothing in the product can ever find them again to try
       * once more. A player who asked to be deleted and was told it failed can ask again.
       */
      throw new HttpError(
        500,
        'We could not remove your photos, so nothing was deleted. Please try again.'
      );
    }
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(userId);

  if (authError) throw new HttpError(500, 'We could not delete your account. Please try again.');
}
