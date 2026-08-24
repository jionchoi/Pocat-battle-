import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { escapeLike } from '../lib/search.js';
import { serializeUser, type ProfileRow } from '../serializers/user.js';

/**
 * Friendships.
 *
 * One row per pair, with direction recorded only until it is accepted. Every read below has to
 * treat the pair as unordered, which is why `idsOf` and `otherSide` exist rather than each
 * query remembering to check both columns — forgetting one is the bug this shape invites, and
 * it fails silently as a friend who is only friends in one direction.
 */

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
}

/**
 * The pair filter, with both ids proved to be UUIDs first.
 *
 * Every `.or()` in this file builds a PostgREST **filter expression** by interpolation, and an
 * expression is not a value: a parenthesis or a comma in an interpolated id is syntax, not
 * text. `unfriend` is where that mattered, because its filter is the whole WHERE clause of a
 * `DELETE` — an id carrying `),id.not.is.null,and(requester_id.eq.` closed the group early and
 * added a disjunct true of every row, turning "delete this friendship" into "delete the table".
 *
 * `uuidParam` in the route layer is the real fix and it stops this reaching here. This exists
 * because the route layer is one file away and a later route, or a service calling a service,
 * would not inherit it. Anything that is not a UUID by the time it is about to become filter
 * syntax is a bug in the caller, so it throws rather than refusing politely.
 */
function pairFilter(a: string, b: string): string {
  for (const id of [a, b]) {
    if (!UUID_RE.test(id)) throw new HttpError(400, 'That is not a valid player id.');
  }

  return (
    `and(requester_id.eq.${a},addressee_id.eq.${b}),` +
    `and(requester_id.eq.${b},addressee_id.eq.${a})`
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** The other person in a friendship, from the point of view of whoever is asking. */
function otherSide(row: FriendshipRow, userId: string): string {
  return row.requester_id === userId ? row.addressee_id : row.requester_id;
}

/**
 * Every friendship this player is in, in one query.
 *
 * `or` across both columns rather than two round trips, because a pair is unordered and a
 * query that looked at one column would return half a friend list.
 */
async function friendshipsOf(userId: string): Promise<FriendshipRow[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) throw error;

  return (data ?? []) as FriendshipRow[];
}

/**
 * The ids of everyone this player is actually friends with.
 *
 * Exported because two other things need it and neither should re-derive it: the friends feed
 * scope, and the friends leaderboard. A second implementation of "who are my friends" is a
 * second place to forget that the pair is unordered.
 */
export async function friendIdsOf(userId: string): Promise<string[]> {
  const rows = await friendshipsOf(userId);

  return rows
    .filter((row) => row.status === 'accepted')
    .map((row) => otherSide(row, userId));
}

/* -------------------------------------------------------------------------- */
/* The list                                                                   */
/* -------------------------------------------------------------------------- */

export async function listFriends(userId: string) {
  const rows = await friendshipsOf(userId);

  const accepted = rows.filter((row) => row.status === 'accepted');
  /*
   * Incoming is a request *addressed to* this player, which is the only kind they may answer.
   * Outgoing is one they sent and are waiting on. The two are drawn differently and it would
   * be easy to serve them from one list and let the client work it out — but then the client
   * would need the direction, and deciding who may accept what is a server question.
   */
  const incoming = rows.filter((row) => row.status === 'pending' && row.addressee_id === userId);
  const outgoing = rows.filter((row) => row.status === 'pending' && row.requester_id === userId);

  const profiles = await profilesFor([
    ...accepted.map((row) => otherSide(row, userId)),
    ...incoming.map((row) => row.requester_id),
    ...outgoing.map((row) => row.addressee_id),
  ]);

  const user = (id: string) => {
    const profile = profiles.get(id);
    return profile ? serializeUser(profile, []) : null;
  };

  return {
    friends: accepted.map((row) => user(otherSide(row, userId))).filter((u) => u !== null),
    incoming: incoming.flatMap((row) => {
      const u = user(row.requester_id);
      // The friendship id rides along because responding needs it, and the client should not
      // have to construct it from a pair of user ids.
      return u ? [{ ...u, friendshipId: row.id }] : [];
    }),
    outgoing: outgoing.map((row) => user(row.addressee_id)).filter((u) => u !== null),
  };
}

/* -------------------------------------------------------------------------- */
/* Asking                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Sends a request, by username.
 *
 * By username rather than id, because that is what a player can type and what the search
 * screen shows. The lookup is case-insensitive against the same `lower(username)` index that
 * enforces uniqueness, so "Mochi" and "mochi" cannot be two people.
 *
 * ## Accepting by asking back
 *
 * If the other person has already asked, this accepts rather than creating a second request.
 * The pair index would refuse the insert anyway, but answering with "already exists" would be
 * a worse reading of what the player meant: two people who have each asked for the other are
 * agreed, and making one of them go and find the notification to confirm it is ceremony.
 */
export async function requestFriend(userId: string, username: string) {
  /*
   * Escaped, and with no wildcards added — this is an exact name, matched case-insensitively.
   *
   * Without the escape, `_` is a single-character wildcard and it is a legal username
   * character, so `mo_hi` sent the request to whoever matched `mochi`. Worse when two accounts
   * matched: `.maybeSingle()` refuses more than one row, so adding a friend answered 500.
   */
  const { data: target, error } = await supabase
    .from('profiles')
    .select('id, username')
    .ilike('username', escapeLike(username.trim()))
    .maybeSingle<{ id: string; username: string }>();

  if (error) throw error;
  if (!target) throw new HttpError(404, 'We could not find anybody with that name.');

  if (target.id === userId) {
    throw new HttpError(400, 'You are already your own best audience.');
  }

  const { data: existing, error: existingError } = await supabase
    .from('friendships')
    .select('*')
    .or(pairFilter(userId, target.id))
    .maybeSingle<FriendshipRow>();

  if (existingError) throw existingError;

  if (existing) {
    if (existing.status === 'accepted') {
      return { status: 'accepted' as const, userId: target.id };
    }

    // They asked first. Asking back is agreement.
    if (existing.addressee_id === userId) {
      await setAccepted(existing.id);
      return { status: 'accepted' as const, userId: target.id };
    }

    // Already asked, still waiting. Idempotent rather than a 409 — the request that gets here
    // twice is almost always one tap retried on a bad connection.
    return { status: 'pending' as const, userId: target.id };
  }

  const { error: insertError } = await supabase
    .from('friendships')
    .insert({ requester_id: userId, addressee_id: target.id });

  if (insertError) throw insertError;

  return { status: 'pending' as const, userId: target.id };
}

/**
 * Answers a request.
 *
 * Only the addressee may. A requester "accepting" their own request would be a one-tap way to
 * add anybody, so the check is on the row rather than on the caller's intent — and it answers
 * 404 rather than 403, because whether a given friendship id exists is not a question a
 * stranger should be able to ask.
 */
export async function respondToRequest(userId: string, friendshipId: string, accept: boolean) {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .eq('id', friendshipId)
    .eq('addressee_id', userId)
    .eq('status', 'pending')
    .maybeSingle<FriendshipRow>();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'That request is no longer waiting for an answer.');

  if (!accept) {
    /*
     * Deleted, not stored as 'declined'.
     *
     * A declined row would hold the pair's unique index forever, so the same two people could
     * never become friends afterwards — and it would be a permanent record of a refusal, which
     * is not a thing worth keeping about anybody.
     */
    const { error: deleteError } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (deleteError) throw deleteError;

    return { status: 'declined' as const };
  }

  await setAccepted(friendshipId);

  return { status: 'accepted' as const };
}

async function setAccepted(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', friendshipId);

  if (error) throw error;
}

/**
 * Removes a friendship from either side.
 *
 * Symmetric on purpose: there is no version of this where one person is still friends. It also
 * cancels a pending request in either direction, because "cancel" and "unfriend" are the same
 * gesture from the player's side and giving them two controls would be asking them to know
 * which state the row is in.
 */
export async function unfriend(userId: string, otherId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(pairFilter(userId, otherId));

  if (error) throw error;
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

export async function profilesFor(ids: readonly string[]): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, created_at, pro_subscription_active, player_stats ( rank, xp )')
    .in('id', unique);

  if (error) throw error;

  const map = new Map<string, ProfileRow>();
  for (const row of (data ?? []) as ProfileRow[]) map.set(row.id, row);

  return map;
}
