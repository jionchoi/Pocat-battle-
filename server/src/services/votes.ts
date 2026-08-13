import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  MAX_VOTES_PER_DAY,
  communityScore,
  emptyReactions,
  type Reaction,
} from '../game/community.js';

/**
 * Reactions, and the counters they move.
 *
 * A vote is the cheapest write in the product and the one with the most downstream effect: it
 * changes the photo's community score, which is what the leaderboards rank on, which is what
 * Photographer Rank is ultimately about. So it goes through the API holding the service-role
 * key rather than straight to Postgres, for the reason §2 gives — RLS can say which rows you
 * may write, not what a photograph is worth.
 */

/* -------------------------------------------------------------------------- */
/* Voting                                                                     */
/* -------------------------------------------------------------------------- */

export async function vote(userId: string, photoId: string, reaction: Reaction) {
  const photo = await votablePhoto(userId, photoId);

  await assertUnderDailyLimit(userId, photoId);

  /*
   * One row per person per photo, updated rather than added to.
   *
   * `votes_one_per_person` makes a second opinion unrepresentable, so changing a reaction is
   * an upsert on that constraint. `vote_count` therefore does not move when somebody switches
   * from laugh to love — the tallies do, the total does not — which is why it is recounted
   * below rather than incremented.
   */
  const { error } = await supabase
    .from('votes')
    .upsert(
      { photo_id: photoId, voter_id: userId, reaction },
      { onConflict: 'photo_id,voter_id' }
    );

  if (error) throw error;

  return recount(photo.id, photo.owner_id, userId);
}

/**
 * The photo a reaction is being left on, or a refusal.
 *
 * Three things have to be true and each fails differently on purpose. It has to exist and be
 * shared — an unshared photo is not visible to react to, and answering 404 rather than 403
 * avoids confirming that a given id is somebody's private photograph. And it must not be the
 * caller's own.
 */
async function votablePhoto(userId: string, photoId: string) {
  const { data, error } = await supabase
    .from('photos')
    .select('id, owner_id, shared_to_feed')
    .eq('id', photoId)
    .maybeSingle<{ id: string; owner_id: string; shared_to_feed: boolean }>();

  if (error) throw error;
  if (!data || !data.shared_to_feed) {
    throw new HttpError(404, 'That photo is not in the feed.');
  }

  /*
   * Voting for yourself is refused rather than silently ignored.
   *
   * Community score is the number rank is computed from, so a self-reaction is the one vote
   * that is straightforwardly self-dealing. The client already disables the row on your own
   * work — `VoteRow` takes `disabled={isMine}` — so anything reaching here has gone around it.
   */
  if (data.owner_id === userId) {
    throw new HttpError(409, 'You cannot react to your own photo.');
  }

  return data;
}

/**
 * The brigading guard.
 *
 * Rolling, like the reveal allowance and for the same reasons — no midnight to farm and no
 * device clock to move. Changing a reaction you already left does not count against it: the
 * row already exists, so this only ever limits how many *different* photographs one account
 * can affect in a day.
 */
async function assertUnderDailyLimit(userId: string, photoId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const { data: existing, error: existingError } = await supabase
    .from('votes')
    .select('photo_id')
    .eq('voter_id', userId)
    .eq('photo_id', photoId)
    .maybeSingle();

  if (existingError) throw existingError;
  // Already reacted to this one. Changing your mind is not a new vote.
  if (existing) return;

  const { count, error } = await supabase
    .from('votes')
    .select('photo_id', { count: 'exact', head: true })
    .eq('voter_id', userId)
    .gte('created_at', since);

  if (error) throw error;

  if ((count ?? 0) >= MAX_VOTES_PER_DAY) {
    throw new HttpError(
      429,
      'You have reacted to a lot of photos today. Come back in a little while.'
    );
  }
}

/**
 * Recounts a photo's reactions and writes every number that depends on them.
 *
 * Counted from `votes` rather than incremented, because the write above may have been an
 * update — and because a counter that is only ever incremented drifts the first time anything
 * goes wrong, with nothing to correct it. This is a handful of rows per photograph.
 */
async function recount(photoId: string, ownerId: string, viewerId: string) {
  const { data, error } = await supabase
    .from('votes')
    .select('reaction, voter_id')
    .eq('photo_id', photoId);

  if (error) throw error;

  const rows = (data ?? []) as { reaction: Reaction; voter_id: string }[];

  const reactions = emptyReactions();
  for (const row of rows) reactions[row.reaction] += 1;

  const voteCount = rows.length;

  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('view_count')
    .eq('id', photoId)
    .maybeSingle<{ view_count: number }>();

  if (photoError) throw photoError;

  const viewCount = photo?.view_count ?? 0;
  const score = communityScore(voteCount, viewCount);

  const { error: writeError } = await supabase
    .from('photos')
    .update({ vote_count: voteCount, community_score: score })
    .eq('id', photoId);

  if (writeError) throw writeError;

  await syncLikesReceived(ownerId);

  return {
    reactions,
    myReaction: rows.find((row) => row.voter_id === viewerId)?.reaction ?? null,
    communityScore: score,
    viewCount,
  };
}

/**
 * The owner's lifetime reaction total.
 *
 * Recomputed rather than incremented, for the same reason as above and one more: it is the
 * dominant term in Photographer Rank, so a value that drifts is a rank that is quietly wrong
 * and nothing in the product would ever notice. A `count` over an indexed column is cheap
 * next to the vote write that preceded it.
 *
 * A failure here is logged rather than thrown. The reaction is already recorded and the photo's
 * own numbers are already right; refusing the request at this point would tell the reader their
 * tap failed when it landed.
 */
async function syncLikesReceived(ownerId: string): Promise<void> {
  try {
    const { data: photos, error } = await supabase
      .from('photos')
      .select('vote_count')
      .eq('owner_id', ownerId);

    if (error) throw error;

    const total = (photos ?? []).reduce(
      (sum, row) => sum + ((row.vote_count as number | null) ?? 0),
      0
    );

    const { error: writeError } = await supabase
      .from('player_stats')
      .update({ likes_received: total })
      .eq('user_id', ownerId);

    if (writeError) throw writeError;
  } catch (err) {
    console.error('[votes] could not update likes_received for', ownerId, err);
  }
}

/* -------------------------------------------------------------------------- */
/* Impressions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Records that these photographs were actually seen.
 *
 * The denominator of the engagement ratio, and it is driven by real viewport events rather
 * than by what a feed page happened to return — a photo the reader scrolled past without
 * reaching is not a view, and counting it would deflate the ratio of everything below the fold.
 *
 * ## Why the insert can be ignored on conflict
 *
 * `photo_views` is keyed on the pair, so a second sighting by the same person is a conflict
 * rather than a row. That is what makes `view_count` *unique viewers*: without the dedupe an
 * account could inflate its own denominator by scrolling, or deflate a rival's ratio by
 * viewing their work repeatedly and never reacting.
 *
 * Returns how many were genuinely new, which is what the client's `{ recorded }` reports.
 */
export async function recordImpressions(
  userId: string,
  photoIds: readonly string[]
): Promise<{ recorded: number }> {
  const unique = [...new Set(photoIds)];
  if (unique.length === 0) return { recorded: 0 };

  /*
   * Your own photographs are not views of them.
   *
   * Opening your own work in the feed would otherwise raise your own denominator and lower
   * your own ratio, which makes checking on a photo a small self-inflicted penalty.
   */
  const { data: foreign, error: foreignError } = await supabase
    .from('photos')
    .select('id')
    .in('id', unique)
    .eq('shared_to_feed', true)
    .neq('owner_id', userId);

  if (foreignError) throw foreignError;

  const eligible = (foreign ?? []).map((row) => row.id as string);
  if (eligible.length === 0) return { recorded: 0 };

  const { data: inserted, error } = await supabase
    .from('photo_views')
    .upsert(
      eligible.map((photoId) => ({ photo_id: photoId, viewer_id: userId })),
      { onConflict: 'photo_id,viewer_id', ignoreDuplicates: true }
    )
    .select('photo_id');

  if (error) throw error;

  const fresh = (inserted ?? []).map((row) => row.photo_id as string);
  if (fresh.length === 0) return { recorded: 0 };

  await bumpViewCounts(fresh);

  return { recorded: fresh.length };
}

/**
 * Moves `view_count` and the score that depends on it, for photos that gained a viewer.
 *
 * One round trip per photograph, which is the honest cost of not having an atomic increment
 * through PostgREST. It is bounded by the batch the client sends — the feed flushes every ten
 * seconds and a reader cannot see thirty new photographs in ten seconds — and only fires for
 * genuinely new viewers, so a reader scrolling their second pass through does nothing at all.
 */
async function bumpViewCounts(photoIds: readonly string[]): Promise<void> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, view_count, vote_count')
    .in('id', photoIds);

  if (error) throw error;

  for (const row of (data ?? []) as {
    id: string;
    view_count: number | null;
    vote_count: number | null;
  }[]) {
    const views = (row.view_count ?? 0) + 1;

    const { error: writeError } = await supabase
      .from('photos')
      .update({
        view_count: views,
        community_score: communityScore(row.vote_count ?? 0, views),
      })
      .eq('id', row.id);

    // Logged, not thrown. A miscounted view is a slightly wrong ratio; a failed feed scroll
    // is a broken screen, and the reader did not ask for either.
    if (writeError) console.error('[views] could not bump', row.id, writeError);
  }
}
