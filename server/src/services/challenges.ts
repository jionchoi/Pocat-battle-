import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  captureStreak,
  pickWinner,
  statusOf,
  type ChallengeJudging,
  type ChallengeStatus,
  type Entrant,
} from '../game/challenges.js';
import { serializePhoto, type PhotoRow } from '../serializers/photo.js';
import { awardXp } from './progression.js';
import { nicknamesFor } from './catNames.js';
import { assembleFeedCards } from './feed.js';

/**
 * Challenges.
 *
 * ## Where the scheduled work went
 *
 * The roadmap asked to "decide where scheduled work runs before writing it". The answer is
 * that **none of it runs on a schedule**, and that is the design rather than a deferral:
 *
 *   - `status` is derived from the window at read time, so nothing has to flip a column at
 *     midnight and no challenge can be stuck "upcoming" because a tick was missed;
 *   - a winner is picked **lazily**, on the first read after `ends_at`, and `settled_at` is
 *     what makes that happen exactly once;
 *   - new challenges are authored ahead as INSERTs, so a quarter of them can be seeded in one
 *     statement and nothing needs to be running for the hub to be right.
 *
 * What this trades away: a challenge that nobody opens stays unsettled, so its winner is
 * decided the first time somebody looks rather than the moment it closed. Since the only thing
 * that reads a settled winner is the screen doing the looking, that difference is unobservable
 * — and it is a whole class of infrastructure not to own.
 */

interface ChallengeRow {
  id: string;
  title: string;
  prompt: string;
  starts_at: string;
  ends_at: string;
  judging: ChallengeJudging;
  icon: string | null;
  reward_xp: number;
  winning_photo_id: string | null;
  settled_at: string | null;
}

/* -------------------------------------------------------------------------- */
/* The hub                                                                    */
/* -------------------------------------------------------------------------- */

export async function activeChallenges(userId: string) {
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .order('ends_at', { ascending: false })
    .limit(40);

  if (error) throw error;

  const rows = (data ?? []) as ChallengeRow[];

  // Settle anything that closed while nobody was looking, before deciding what to send.
  await settleClosed(rows);

  const [entries, counts] = await Promise.all([
    myEntries(userId, rows.map((row) => row.id)),
    submissionCounts(rows.map((row) => row.id)),
  ]);

  const active: ReturnType<typeof serializeChallenge>[] = [];
  const past: ReturnType<typeof serializeChallenge>[] = [];

  for (const row of rows) {
    const status = statusOf(row.starts_at, row.ends_at);
    const card = serializeChallenge(row, status, counts.get(row.id) ?? 0, entries.get(row.id) ?? null);

    // `upcoming` rides with `active`: the hub's first list is "what is coming and what is on",
    // and a challenge nobody can enter yet is still the next thing to plan for.
    if (status === 'closed') past.push(card);
    else active.push(card);
  }

  const headline = rows.find((row) => statusOf(row.starts_at, row.ends_at) === 'active');

  return {
    active,
    past,
    leader: headline ? await leaderOf(headline.id) : null,
    streakDays: await streakFor(userId),
    /*
     * `goals` is deliberately absent rather than empty.
     *
     * The hub drops each optional surface on its own when its field is missing — an empty
     * array would draw a heading over nothing. Standing goals are authored content rather
     * than a query, and there is nothing to author them from yet.
     */
  };
}

function serializeChallenge(
  row: ChallengeRow,
  status: ChallengeStatus,
  submissionCount: number,
  mySubmissionPhotoId: string | null
) {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    winningPhotoId: row.winning_photo_id ?? undefined,

    status,
    judging: row.judging,
    submissionCount,
    mySubmissionPhotoId,

    // Derived from the rule that actually grants it, so the copy cannot promise a number
    // nothing pays. Null rather than "0 XP", which reads as a challenge not worth entering.
    reward: row.reward_xp > 0 ? `${row.reward_xp} XP` : null,
    icon: (row.icon ?? null) as
      | 'rain'
      | 'sun'
      | 'night'
      | 'rarity'
      | 'community'
      | 'trophy'
      | null,
  };
}

/* -------------------------------------------------------------------------- */
/* Settling                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Picks winners for challenges that have closed and were never judged.
 *
 * Idempotent by `settled_at`, which is written in the same update as the winner. A second
 * reader arriving in the same second could settle one twice — the update is not conditional —
 * and the consequence is that it writes the same winner again, because `pickWinner` is a total
 * ordering over the same rows. That is why the tie-break falls through to the photo id.
 *
 * Failures are logged and swallowed. A challenge that could not be settled shows no winner
 * yet, which is a state the hub already draws; failing the whole request would take the
 * player's entire challenges tab down over one closed card.
 */
async function settleClosed(rows: readonly ChallengeRow[]): Promise<void> {
  const due = rows.filter(
    (row) => row.settled_at === null && statusOf(row.starts_at, row.ends_at) === 'closed'
  );

  for (const row of due) {
    try {
      await settle(row);
    } catch (err) {
      console.error('[challenges] could not settle', row.id, err);
    }
  }
}

async function settle(row: ChallengeRow): Promise<void> {
  const { data, error } = await supabase
    .from('challenge_entries')
    .select('photo_id, user_id, photos ( score_total, community_score, vote_count )')
    .eq('challenge_id', row.id);

  if (error) throw error;

  const entrants: (Entrant & { userId: string })[] = [];

  for (const entry of data ?? []) {
    // PostgREST types a to-one embed as an array when it cannot prove the cardinality.
    const raw = entry.photos as
      | { score_total: number | null; community_score: number | null; vote_count: number | null }[]
      | { score_total: number | null; community_score: number | null; vote_count: number | null }
      | null;

    const photo = Array.isArray(raw) ? raw[0] : raw;
    if (!photo) continue;

    entrants.push({
      photoId: entry.photo_id as string,
      userId: entry.user_id as string,
      scoreTotal: photo.score_total,
      communityScore: photo.community_score ?? 0,
      voteCount: photo.vote_count ?? 0,
    });
  }

  const winnerPhotoId = pickWinner(entrants, row.judging);

  const { error: writeError } = await supabase
    .from('challenges')
    .update({ winning_photo_id: winnerPhotoId, settled_at: new Date().toISOString() })
    .eq('id', row.id);

  if (writeError) throw writeError;

  /*
   * Paid after the challenge is marked settled, not before.
   *
   * If the award fails, the challenge is still closed with its winner named and the XP is
   * simply missing — which is recoverable by hand. The other order risks paying twice: an
   * award that succeeded followed by an update that failed would leave the row unsettled and
   * the next reader would pay it again.
   */
  const winner = entrants.find((e) => e.photoId === winnerPhotoId);
  if (winner && row.reward_xp > 0) {
    await awardXp(winner.userId, row.reward_xp);
  }
}

/* -------------------------------------------------------------------------- */
/* Entering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The photographs a player could enter.
 *
 * Their own, captured inside some currently-active challenge's window, and scored or not —
 * scoring is rationed and entering is not, so gating this on a reveal would mean a player who
 * used today's two allowances cannot take part at all.
 *
 * Each carries `submittedToChallengeId` so the submission screen can show what is already
 * entered without a second request.
 */
export async function eligiblePhotos(userId: string) {
  const { data: open, error: openError } = await supabase
    .from('challenges')
    .select('id, starts_at, ends_at')
    .lte('starts_at', new Date().toISOString())
    .gt('ends_at', new Date().toISOString());

  if (openError) throw openError;

  const windows = (open ?? []) as { id: string; starts_at: string; ends_at: string }[];
  if (windows.length === 0) return { photos: [] };

  // The widest open window, so one query covers every challenge running at once.
  const earliest = windows.reduce(
    (min, w) => (w.starts_at < min ? w.starts_at : min),
    windows[0]!.starts_at
  );

  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('owner_id', userId)
    .gte('captured_at', earliest)
    .order('captured_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  const rows = (data ?? []) as PhotoRow[];
  const entered = await entriesByPhoto(rows.map((row) => row.id));
  const names = await nicknamesFor(
    userId,
    rows.map((row) => row.cat_id).filter((id): id is string => id !== null)
  );

  return {
    photos: rows.map((row) => ({
      ...serializePhoto(row, row.cat_id ? (names.get(row.cat_id) ?? null) : null),
      submittedToChallengeId: entered.get(row.id),
    })),
  };
}

/**
 * Enters a photograph, or moves an existing entry onto it.
 *
 * Entering shares the photo to the feed, because it has to be visible to be judged — the
 * submission screen states that before the player commits rather than leaving them to discover
 * their album became public.
 */
export async function submitEntry(userId: string, challengeId: string, photoId: string) {
  const challenge = await openChallenge(challengeId);

  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('*')
    .eq('id', photoId)
    .eq('owner_id', userId)
    .maybeSingle<PhotoRow>();

  if (photoError) throw photoError;
  if (!photo) throw new HttpError(404, 'That photo is not in your album.');

  if (photo.captured_at < challenge.starts_at || photo.captured_at >= challenge.ends_at) {
    throw new HttpError(
      400,
      'That photo was taken outside this challenge. Pick one from while it has been running.'
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from('challenge_entries')
    .select('id, photo_id')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .maybeSingle<{ id: string; photo_id: string }>();

  if (existingError) throw existingError;

  const alreadyEntered = existing?.photo_id === photoId;

  if (existing) {
    // Moves rather than adds. `challenge_entries_one_per_player` is the rule, not a guard.
    if (!alreadyEntered) {
      const { error } = await supabase
        .from('challenge_entries')
        .update({ photo_id: photoId })
        .eq('id', existing.id);

      if (error) throw error;
    }
  } else {
    const { error } = await supabase
      .from('challenge_entries')
      .insert({ challenge_id: challengeId, user_id: userId, photo_id: photoId });

    if (error) throw error;
  }

  // Judged means visible. Written even on a re-submission of the same photo, so a player who
  // un-shared it since entering is put back in the running rather than silently disqualified.
  const { data: shared, error: shareError } = await supabase
    .from('photos')
    .update({ shared_to_feed: true })
    .eq('id', photoId)
    .eq('owner_id', userId)
    .select('*')
    .maybeSingle<PhotoRow>();

  if (shareError) throw shareError;

  const row = shared ?? photo;

  return {
    photo: {
      ...serializePhoto(row, await nicknameOf(userId, row)),
      submittedToChallengeId: challengeId,
    },
    alreadyEntered,
  };
}

async function openChallenge(challengeId: string) {
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .maybeSingle<ChallengeRow>();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'We could not find that challenge.');

  const status = statusOf(data.starts_at, data.ends_at);

  if (status === 'upcoming') {
    throw new HttpError(400, 'That challenge has not started yet.');
  }
  if (status === 'closed') {
    throw new HttpError(400, 'That challenge has finished.');
  }

  return data;
}

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything entered into one challenge, as feed cards.
 *
 * Reuses the feed's assembly rather than a second one of its own — an entry is a shared
 * photograph with an author and a reaction tally beside it, which is exactly what a feed card
 * is, and two implementations of that would be two places for the author lookup to N+1.
 */
export async function challengeEntries(viewerId: string, challengeId: string) {
  const { data, error } = await supabase
    .from('challenge_entries')
    .select('photo_id')
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const photoIds = (data ?? []).map((row) => row.photo_id as string);
  if (photoIds.length === 0) return { entries: [] };

  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('*')
    .in('id', photoIds);

  if (photosError) throw photosError;

  return { entries: await assembleFeedCards((photos ?? []) as PhotoRow[], viewerId) };
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/** This player's entry photo per challenge, in one query. */
async function myEntries(
  userId: string,
  challengeIds: readonly string[]
): Promise<Map<string, string>> {
  if (challengeIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('challenge_entries')
    .select('challenge_id, photo_id')
    .eq('user_id', userId)
    .in('challenge_id', challengeIds);

  if (error) throw error;

  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(row.challenge_id as string, row.photo_id as string);

  return map;
}

/** How many have entered each challenge, in one query rather than one count per card. */
async function submissionCounts(
  challengeIds: readonly string[]
): Promise<Map<string, number>> {
  if (challengeIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('challenge_entries')
    .select('challenge_id')
    .in('challenge_id', challengeIds);

  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.challenge_id as string;
    map.set(id, (map.get(id) ?? 0) + 1);
  }

  return map;
}

/** Which challenge each photo is entered in, for the submission grid. */
async function entriesByPhoto(photoIds: readonly string[]): Promise<Map<string, string>> {
  if (photoIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('challenge_entries')
    .select('photo_id, challenge_id')
    .in('photo_id', photoIds);

  if (error) throw error;

  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(row.photo_id as string, row.challenge_id as string);

  return map;
}

/**
 * Who is ahead in the headline challenge.
 *
 * Only meaningful while it is open, which is why the caller only asks for an active one.
 * Ranked on reactions across the entrant's entry, because that is the standing a player can
 * still change — a score is fixed the moment it is revealed.
 */
async function leaderOf(challengeId: string) {
  const { data, error } = await supabase
    .from('challenge_entries')
    .select('user_id, photos ( vote_count ), profiles ( id, username, avatar_url )')
    .eq('challenge_id', challengeId);

  if (error) throw error;

  let best: { userId: string; username: string; avatarUrl: string; reactions: number } | null =
    null;

  for (const row of data ?? []) {
    const photoRaw = row.photos as { vote_count: number | null }[] | { vote_count: number | null } | null;
    const photo = Array.isArray(photoRaw) ? photoRaw[0] : photoRaw;

    const profileRaw = row.profiles as
      | { id: string; username: string | null; avatar_url: string | null }[]
      | { id: string; username: string | null; avatar_url: string | null }
      | null;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;

    if (!profile?.username) continue;

    const reactions = photo?.vote_count ?? 0;
    if (best && reactions <= best.reactions) continue;

    best = {
      userId: profile.id,
      username: profile.username,
      avatarUrl: profile.avatar_url ?? '',
      reactions,
    };
  }

  if (!best) return null;

  return {
    user: { id: best.userId, username: best.username, avatarUrl: best.avatarUrl },
    // One entry per player, so this is always one. Kept because the client's type carries it
    // and because a future format allowing several would change only this number.
    qualifyingShots: 1,
    reactions: best.reactions,
  };
}

/**
 * The player's consecutive-capture run.
 *
 * Reads only the last few weeks of capture times. A streak is broken by one missing day, so
 * nothing further back than the longest plausible run can affect the answer, and selecting a
 * whole album to count days would be the most expensive query on the hub.
 */
async function streakFor(userId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('photos')
    .select('captured_at')
    .eq('owner_id', userId)
    .gte('captured_at', since)
    .order('captured_at', { ascending: false });

  if (error) throw error;

  return captureStreak((data ?? []).map((row) => row.captured_at as string));
}

async function nicknameOf(userId: string, row: PhotoRow): Promise<string | null> {
  if (!row.cat_id) return null;
  return (await nicknamesFor(userId, [row.cat_id])).get(row.cat_id) ?? null;
}
