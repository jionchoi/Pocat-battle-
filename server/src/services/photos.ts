import { supabase } from '../lib/supabase.js';
import { scorePhoto } from '../lib/openai.js';
import { assertOwnedPath, deletePhotoObject, downloadPhoto } from '../lib/storage.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  MAX_SCORING_ATTEMPTS,
  REVEAL_LIMITS,
  REVEAL_WINDOW_HOURS,
  totalOf,
} from '../game/scoring.js';
import { PHOTO_LIMITS, SHOWCASE_LIMIT } from '../game/album.js';
import { serializePhoto, type PhotoRow } from '../serializers/photo.js';
import { awardForScore } from './progression.js';
import { nicknamesFor } from './catNames.js';
import { promoteBestPhoto } from './catDex.js';
import { candidatesFor, type CatCandidate } from './catMatching.js';

/**
 * The capture loop.
 *
 * Two entry points, and they are the same act split by whether the player had an allowance
 * left at the time: `capture` stores the photograph and scores it if it can, `reveal`
 * scores one it could not. Both funnel into `applyScore`, so a photo scored a day late is
 * scored by exactly the same code as one scored on the spot.
 */

/* -------------------------------------------------------------------------- */
/* The allowance                                                              */
/* -------------------------------------------------------------------------- */

export interface RevealAllowance {
  /** Null when unlimited. */
  limit: number | null;
  used: number;
  remaining: number | null;
  /** When the oldest reveal in the window falls out of it. Null if nothing to wait for. */
  resetsAt: string | null;
}

/**
 * How many reveals a player has left.
 *
 * Counted from the `reveals` ledger, which replaced counting `photos.scored_at` rows — see
 * the migration for the argument. The short version: counting photos means the count
 * forgets, so deleting a scored photo used to hand its reveal back, and two-a-day was
 * really unlimited for anyone willing to delete what they did not like.
 *
 * The window rolls. There is no midnight to wait for and no timezone to argue about, and
 * moving the device clock forward buys nothing because the comparison happens here.
 */
export async function revealAllowance(userId: string): Promise<RevealAllowance> {
  const limit = (await isPro(userId)) ? REVEAL_LIMITS.pro : REVEAL_LIMITS.free;

  const since = new Date(Date.now() - REVEAL_WINDOW_HOURS * 3600_000).toISOString();

  const { data, error } = await supabase
    .from('reveals')
    .select('scored_at')
    .eq('user_id', userId)
    .gte('scored_at', since)
    .order('scored_at', { ascending: true });

  if (error) throw error;

  const used = data?.length ?? 0;

  return {
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    // The oldest reveal in the window is the one that frees a slot when it ages out.
    resetsAt:
      limit !== null && used >= limit && data?.[0]?.scored_at
        ? new Date(
            new Date(data[0].scored_at).getTime() + REVEAL_WINDOW_HOURS * 3600_000
          ).toISOString()
        : null,
  };
}

/** Both limits in this file are the free tier's, so both start with the same question. */
async function isPro(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('pro_subscription_active')
    .eq('id', userId)
    .single();

  return data?.pro_subscription_active === true;
}

/* -------------------------------------------------------------------------- */
/* The album's capacity                                                       */
/* -------------------------------------------------------------------------- */

export interface AlbumUsage {
  count: number;
  /** Null when unbounded. */
  limit: number | null;
  /**
   * True when the album is holding more than it should — which is only ever by one, and
   * only until the player answers the prompt.
   *
   * The client draws the resolution sheet from this rather than comparing the two numbers
   * itself, so "what counts as full" is decided in exactly one place.
   */
  overflowing: boolean;
}

export async function albumUsage(userId: string): Promise<AlbumUsage> {
  const limit = (await isPro(userId)) ? PHOTO_LIMITS.pro : PHOTO_LIMITS.free;

  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId);

  if (error) throw error;

  const used = count ?? 0;

  return { count: used, limit, overflowing: limit !== null && used > limit };
}

/**
 * That the album can take one more.
 *
 * Refuses only when it is *already* over, which is what makes the overflow exactly one
 * photograph. At the cap the capture goes through and the player is asked to resolve it;
 * past the cap there is an unanswered question, and taking more photos is not an answer.
 */
async function assertAlbumHasRoom(userId: string): Promise<AlbumUsage> {
  const usage = await albumUsage(userId);

  if (usage.overflowing) {
    throw new HttpError(
      409,
      `Your album is holding ${usage.count} of ${usage.limit} photos. Delete one, or discard your last shot, before taking another.`,
      'album_full'
    );
  }

  return usage;
}

/* -------------------------------------------------------------------------- */
/* The shortlist that rides along                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cats this photograph might be of, for the sheet that opens on the reveal screen.
 *
 * Sent with the capture rather than fetched after it, because this is the moment the question
 * gets asked and a second round trip the instant the screen appears would be asking the server
 * for something it already knew while writing the row.
 *
 * ## Two rules, and both are about not asking a stupid question
 *
 * A photograph the model looked at and found no cat in gets no shortlist. "Which cat is this?"
 * about a picture of an empty doorway is worse than useless — it invites somebody to attach a
 * doorway to their Dex. Every other outcome does get one, including the unscored paths:
 * identifying deliberately does not wait for a score, so a capture taken past the day's
 * allowance can still be named. It simply ranks on proximity alone, because nothing has
 * described it yet.
 *
 * A failure here is never the capture's failure. The photograph is saved, the score is
 * written, the reveal is spent — and matching is the least important thing that happened.
 * Losing it omits the field, which the client already reads as "this server does not do
 * matching" and draws no sheet for, rather than turning a successful capture into an error.
 */
async function shortlistFor(
  userId: string,
  row: PhotoRow,
  outcome?: ScoreOutcome
): Promise<CatCandidate[] | undefined> {
  if (outcome && !outcome.scored && outcome.reason === 'no_cat') return undefined;

  try {
    return await candidatesFor(userId, row);
  } catch (err) {
    console.error('[matching] could not shortlist cats for', row.id, err);
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Capture                                                                    */
/* -------------------------------------------------------------------------- */

export interface CaptureInput {
  userId: string;
  storagePath: string;
  lat: number;
  lng: number;
  capturedAt?: string;
  /**
   * Whether the phone's own detector saw a cat when the shutter fired.
   *
   * Trusted in one direction only, and that asymmetry is the entire security argument: a
   * `false` skips the model call, and a `true` grants nothing that was not already going to
   * happen. A client lying in the expensive direction spends its own two reveals a day and
   * reaches no further, so this is a saving the app can offer rather than a permission it
   * can claim.
   *
   * Absent means "did not say", which is treated as detected. Older builds do not send it
   * and must not be silently downgraded to never scoring anything.
   */
  detected?: boolean;
}

/**
 * Records a capture, and scores it if the player has an allowance left.
 *
 * The row is written before any scoring is attempted, and that order is the whole point:
 * the shutter is free and unlimited, so a photograph is kept whether or not it can be
 * judged today, and whether or not the model is reachable at this moment. A capture is
 * never lost to a scoring failure.
 */
export async function capture(input: CaptureInput) {
  assertOwnedPath(input.storagePath, input.userId);

  /*
   * The bytes are already in the bucket by the time this runs — the phone uploads directly
   * and then posts the path — so a refusal here has to take them back out. Otherwise every
   * capture attempted against a full album leaves an object nothing will ever reference,
   * and the storage cap becomes a way to fill storage.
   */
  try {
    await assertAlbumHasRoom(input.userId);
  } catch (err) {
    await deletePhotoObject(input.storagePath);
    throw err;
  }

  const { data: row, error } = await supabase
    .from('photos')
    .insert({
      owner_id: input.userId,
      storage_path: input.storagePath,
      captured_lat: input.lat,
      captured_lng: input.lng,
      captured_at: input.capturedAt ?? new Date().toISOString(),
    })
    .select('*')
    .single<PhotoRow>();

  if (error || !row) {
    // The bytes are already in the bucket and now have no row pointing at them. Nothing
    // will ever look them up again, so they are removed rather than left to accumulate.
    await deletePhotoObject(input.storagePath);
    throw error ?? new HttpError(500, 'We could not save that photo.');
  }

  const allowance = await revealAllowance(input.userId);

  if (allowance.remaining !== null && allowance.remaining <= 0) {
    // Kept, unscored, and revealable later. This is the ordinary path once a player has
    // used today's allowance, not a failure.
    return {
      photo: serializePhoto(row, null),
      allowance,
      scored: false,
      /*
       * Null, and that distinction is what the reveal screen branches on. Nothing went
       * wrong here — the player has used today's scores and this photograph is waiting its
       * turn, which is the ordinary state the padlock was drawn for. A failure sheet on
       * this path would turn the app working as designed into an error message.
       */
      scoreError: null,
      album: await albumUsage(input.userId),
      candidates: await shortlistFor(input.userId, row),
    };
  }

  /*
   * The camera saw nothing, so nothing is sent to be judged.
   *
   * The cheapest call is the one not made, and the phone already looked at this scene for a
   * second and a half before the shutter fired. Paying a vision model to confirm an empty
   * doorway is the most avoidable spend in the pipeline.
   *
   * The photograph is still kept — the shutter is free and always has been — and the client
   * offers "score it anyway" for the case the on-device detector is simply wrong, which it
   * will be, because it is a texture-and-motion heuristic rather than a cat detector. That
   * button is a player deciding to spend, which is the only thing that should be able to
   * override this.
   */
  if (input.detected === false) {
    return {
      photo: serializePhoto(row, null),
      allowance,
      scored: false,
      scoreError: {
        reason: 'not_detected',
        message: 'We could not see a cat in the frame, so this one was saved without a score.',
      },
      album: await albumUsage(input.userId),
      /*
       * Still shortlisted, unlike the model's `no_cat`. This verdict came from a
       * texture-and-motion heuristic on the phone rather than from anything that looked at the
       * animal, and the player is being offered "score it anyway" on the same screen for
       * exactly that reason. Somebody who knows perfectly well this is Mochi should be able to
       * say so.
       */
      candidates: await shortlistFor(input.userId, row),
    };
  }

  const outcome = await applyScore(row);
  const award = await creditScore(input.userId, outcome);

  /*
   * The usage is read after the insert, so an album that has just gone one over reports
   * `overflowing` on the response that put it there. That is what raises the sheet asking
   * the player to delete something or discard this one — and by this point the score is
   * written and the reveal is spent, which is the whole shape of the choice: it is a
   * decision about which photograph to keep, not about whether to pay for one.
   */
  // The scored row, not the one inserted above — the traits the model returned are on it, and
  // they are what the shortlist ranks against. Passing the stale row would rank on proximity
  // alone and quietly waste the description that was just paid for.
  const settled = outcome.scored ? outcome.row : row;

  return {
    photo: serializePhoto(settled, null),
    allowance: await revealAllowance(input.userId),
    scored: outcome.scored,
    scoreError: outcome.scored
      ? null
      : { reason: outcome.reason, message: outcome.message },
    album: await albumUsage(input.userId),
    candidates: await shortlistFor(input.userId, settled, outcome),
    award,
  };
}

/**
 * Pays out for a score, if there was one.
 *
 * Both entry points call this immediately after `applyScore`, so a photograph scored a day
 * late earns exactly what it would have earned on the spot. An unscored outcome earns
 * nothing and returns null rather than a zeroed award — a "+0 XP" on the reveal screen reads
 * as the capture having been worth nothing, which is why the field was taken off the
 * response in the first place.
 *
 * Failures here are logged and swallowed. By this point the photograph is stored and the
 * score is written; turning a progression write into a 500 would report failure for a
 * request that did the thing the player actually asked for, and would do it *after* spending
 * their reveal.
 */
async function creditScore(userId: string, outcome: ScoreOutcome) {
  if (!outcome.scored) return null;

  try {
    return await awardForScore(userId, outcome.row.score_total ?? 0);
  } catch (err) {
    console.error('[progression] could not credit score for', userId, err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Reveal                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Scores a photo that was stored without one.
 *
 * Refuses a photo that already has a score. That is not a guard against a race so much as
 * the product rule: a score is given once and stands, so there is no such thing as trying
 * again for a better one.
 */
export async function reveal(userId: string, photoId: string) {
  const row = await ownedPhoto(userId, photoId);

  if (row.scored_at) {
    throw new HttpError(409, 'That photo already has a score.');
  }

  const allowance = await revealAllowance(userId);

  if (allowance.remaining !== null && allowance.remaining <= 0) {
    throw new HttpError(429, 'You have used your scores for now. Another one frees up soon.');
  }

  const outcome = await applyScore(row);
  const award = await creditScore(userId, outcome);
  const settled = outcome.scored ? outcome.row : row;

  /*
   * A failed reveal is a 200, not an error.
   *
   * The request did what was asked of it: it looked, and there was no score to be had. The
   * allowance is untouched — nothing reached the ledger, because `applyScore` writes there
   * only after a score lands — so this is a retry the player has not paid for, and the
   * shape of the reply says so rather than making the app infer it from an unchanged number.
   */
  return {
    photo: serializePhoto(settled, await nicknameOf(userId, settled)),
    allowance: await revealAllowance(userId),
    scored: outcome.scored,
    scoreError: outcome.scored
      ? null
      : { reason: outcome.reason, message: outcome.message },
    album: await albumUsage(userId),
    candidates: await shortlistFor(userId, settled, outcome),
    award,
  };
}

/* -------------------------------------------------------------------------- */
/* One photo                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fetches one of the caller's own photos, or refuses.
 *
 * Every single-photo route starts here, and they all get the same answer for a photo that
 * does not exist and a photo that belongs to somebody else: 404, in the player's words.
 * Distinguishing the two would answer "does this id exist" for anyone willing to ask, and
 * in a game with a public bucket the ids are the privacy boundary.
 *
 * Exported for `catIdentity.ts`, which needs the same refusal on the same terms. That
 * dependency runs one way only — nothing in this file may import from there, or the two
 * become a cycle.
 */
export async function ownedPhoto(userId: string, photoId: string): Promise<PhotoRow> {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('id', photoId)
    .eq('owner_id', userId)
    .maybeSingle<PhotoRow>();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'That photo is not in your album.');

  return data;
}

/** The nickname this player has for the photo's cat, or empty while it is unidentified. */
async function nicknameOf(userId: string, row: PhotoRow): Promise<string | null> {
  if (!row.cat_id) return null;
  return (await nicknamesFor(userId, [row.cat_id])).get(row.cat_id) ?? null;
}

export async function detail(userId: string, photoId: string) {
  const row = await ownedPhoto(userId, photoId);
  return { photo: serializePhoto(row, await nicknameOf(userId, row)) };
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                    */
/* -------------------------------------------------------------------------- */

export interface PhotoPatch {
  caption?: string;
  sharedToFeed?: boolean;
  showcased?: boolean;
  sharedToMap?: boolean;
}

/**
 * The four fields a player owns on their own photo.
 *
 * Exactly the four the migrations grant `update` on — the column grant is what stops the
 * *app* writing a score, and this list is the same boundary drawn again on the side that
 * holds the service-role key, where no grant applies. Adding a fifth field here without
 * adding it there means the app cannot do what the API just allowed; adding it there without
 * adding it here means nothing, which is the safe direction.
 */
export async function update(userId: string, photoId: string, patch: PhotoPatch) {
  const row = await ownedPhoto(userId, photoId);

  const changes: Record<string, unknown> = {};

  if (patch.caption !== undefined) {
    const caption = patch.caption.trim();
    // Cleared, not blanked. An empty string would render as a caption that is there and
    // says nothing; the column's null is the absence the album already knows how to draw.
    changes['caption'] = caption === '' ? null : caption;
  }

  if (patch.sharedToFeed !== undefined) {
    /*
     * An unscored photo shares like any other, and this is deliberate.
     *
     * Scoring is the rationed part; showing people your cats is the app. Gating the feed on
     * a reveal would mean a player who has used today's two scores cannot post at all, which
     * turns a limit on judgement into a limit on participation — the opposite of the point.
     *
     * The consequence lands on whoever builds the feed serializer: `scoredAt` is null on
     * these, and the card has to draw that as "not scored yet" rather than trusting the
     * zeroes the album serializer fills in. See the note there.
     */
    changes['shared_to_feed'] = patch.sharedToFeed;
  }

  if (patch.showcased !== undefined) {
    if (patch.showcased && !row.showcased) {
      await assertShowcaseHasRoom(userId);
    }

    changes['showcased'] = patch.showcased;
  }

  if (patch.sharedToMap !== undefined) {
    /*
     * Takes the pin down, and leaves the coordinates where they are.
     *
     * They are two different things and conflating them would break the Dex: proximity to
     * `cats.last_seen_*` is the strongest matching signal there is, so a photo that cleared
     * its own location would stop being able to recognise the cat it is of. What the player
     * is switching off is publication, not recording — and the privacy screen says exactly
     * that, so the two agree.
     *
     * There is nothing to undo either. A photo un-shared from the map is filtered out of
     * `/map/sightings` from the next request onward, because the pin is a live read of this
     * flag rather than a row written when the capture happened.
     */
    changes['shared_to_map'] = patch.sharedToMap;
  }

  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, 'There was nothing to change.');
  }

  const { data, error } = await supabase
    .from('photos')
    .update(changes)
    .eq('id', photoId)
    .eq('owner_id', userId)
    .select('*')
    .maybeSingle<PhotoRow>();

  if (error) throw error;
  // An UPDATE that matches nothing is a success in Postgres, so the row is selected back
  // rather than assumed. `ownedPhoto` above already proved it exists; this catches it being
  // deleted in between.
  if (!data) throw new HttpError(404, 'That photo is not in your album.');

  return { photo: serializePhoto(data, await nicknameOf(userId, data)) };
}

/**
 * That there is room for one more pinned photo.
 *
 * Counted rather than tracked, for the same reason the reveal allowance is: the `showcased`
 * flags are the fact, and a running total beside them is a second copy that eventually
 * disagrees with it.
 *
 * Two pins racing can both pass this check and land a seventh photo in the showcase. That is
 * a player pressing pin twice on two devices in the same instant, the damage is one extra
 * tile on their own profile, and the honest fix is a database constraint rather than a lock
 * held across an HTTP request. Noted rather than hidden.
 */
async function assertShowcaseHasRoom(userId: string): Promise<void> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .eq('showcased', true);

  if (error) throw error;

  if ((count ?? 0) >= SHOWCASE_LIMIT) {
    throw new HttpError(
      409,
      `Your showcase holds ${SHOWCASE_LIMIT} photos. Unpin one to make room.`,
      'showcase_full'
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Deleting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Removes a photo, its bytes, and its trace in the Dex.
 *
 * Three things have to happen and they are ordered by what a failure would cost:
 *
 *   1. read which Dex entries point at this photo — *before* the delete, because the
 *      foreign key is ON DELETE SET NULL and the moment the row goes, so does the evidence
 *      that this photo was ever a cat's best shot;
 *   2. delete the row, which is the delete the player asked for and the only step whose
 *      failure aborts the rest;
 *   3. delete the object and repair the Dex, both after the fact. A leftover object is
 *      unreferenced bytes; a stale Dex entry is a cat card with no photo on it.
 */
export async function remove(userId: string, photoId: string) {
  const row = await ownedPhoto(userId, photoId);

  const { data: entries, error: entriesError } = await supabase
    .from('cat_dex_entries')
    .select('id, cat_id')
    .eq('user_id', userId)
    .eq('best_photo_id', photoId);

  if (entriesError) throw entriesError;

  const { error: deleteError } = await supabase
    .from('photos')
    .delete()
    .eq('id', photoId)
    .eq('owner_id', userId);

  if (deleteError) throw deleteError;

  await deletePhotoObject(row.storage_path);

  for (const entry of entries ?? []) {
    // The photograph that was this cat's tile no longer exists, so the pin the player set by
    // hand has nothing left to point at — see the note on `releasePin`.
    await promoteBestPhoto(userId, entry.id as string, entry.cat_id as string, {
      releasePin: true,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Why a photograph came back without a score.
 *
 * Two reasons, and the difference is the whole point of carrying it: one of them is worth
 * trying again and the other never will be. A model that timed out will answer next time;
 * a photograph with no cat in it contains no cat on the second look either, and offering
 * "try again" there would sell a player a reveal that cannot succeed.
 */
export type ScoreFailure = 'no_cat' | 'scoring_failed' | 'not_detected';

type ScoreOutcome =
  | { scored: true; row: PhotoRow }
  | { scored: false; reason: ScoreFailure; message: string };

/**
 * Fetches the image, judges it, and writes the verdict.
 *
 * Every score column is written in one update, because the schema will not accept a photo
 * that is half scored — a check constraint requires the components, the total, the tier,
 * the pose and the model to arrive together or not at all.
 *
 * Nothing here adjusts the model's numbers. `totalOf` sums the components it returned, and
 * that is the only arithmetic in the pipeline.
 *
 * ## Returns a failure rather than throwing one
 *
 * This used to throw, and the throw propagated all the way out of `capture` — so a scoring
 * problem became a failed HTTP request for an operation that had largely succeeded. The row
 * was already written by then and stayed written, which meant the app reported an error
 * while the photograph silently landed in the album. The player was told one thing and the
 * database did another.
 *
 * Now the caller gets both facts and can say both: the photo is saved, and here is what
 * happened to its score.
 */
async function applyScore(row: PhotoRow): Promise<ScoreOutcome> {
  /*
   * ────────────────────────────────────────────────────────────────────────
   *  Everything from here to the `scorePhoto` call below is a spend guard.
   *  A model call costs money whatever it returns, so every reason not to
   *  make one has to be checked before it, not after.
   * ────────────────────────────────────────────────────────────────────────
   */

  /*
   * Already judged not to contain a cat.
   *
   * The photograph has not changed since the model said so, so neither will the answer. The
   * player's route forward is another shot, not another look at this one, and the client
   * says exactly that rather than offering a retry it knows cannot work.
   */
  if (row.no_cat_at) {
    return {
      scored: false,
      reason: 'no_cat',
      message: 'There is no cat in that photo. Take another shot to get a score.',
    };
  }

  if (row.scoring_attempts >= MAX_SCORING_ATTEMPTS) {
    return {
      scored: false,
      reason: 'scoring_failed',
      message: 'We tried a few times and could not score that one. Take another shot.',
    };
  }

  /*
   * Counted before the call, not after.
   *
   * The whole risk being defended against is a call that costs money and then fails, and a
   * counter incremented afterwards is not incremented on exactly that path — which is to
   * say it would count the calls that were free and miss the ones that were not.
   *
   * A failure to record the attempt aborts the attempt. Refusing to score is a bad minute
   * for one player; scoring without being able to count it is an unmetered endpoint.
   */
  const { data: counted, error: countError } = await supabase
    .from('photos')
    .update({ scoring_attempts: row.scoring_attempts + 1 })
    .eq('id', row.id)
    .select('scoring_attempts')
    .single<{ scoring_attempts: number }>();

  if (countError || !counted) {
    console.error('[scoring] could not record an attempt for', row.id, countError?.message);

    return {
      scored: false,
      reason: 'scoring_failed',
      message: 'We could not score that photo just now. It is saved in your album.',
    };
  }

  let image: Buffer;
  let judged: Awaited<ReturnType<typeof scorePhoto>>;

  /*
   * Everything that talks to something outside this process, in one try.
   *
   * Reading the object and calling the model are separate failures with the same remedy —
   * wait a moment and reveal it again — so they are one branch here. Their messages are
   * already written for a player to read, which is why the message travels rather than
   * being replaced by something generic on the way out.
   */
  try {
    image = await downloadPhoto(row.storage_path);
    judged = await scorePhoto(image);
  } catch (err) {
    const message =
      err instanceof HttpError
        ? err.message
        : 'We could not score that photo just now. It is saved in your album.';

    if (!(err instanceof HttpError)) {
      console.error('[scoring] unexpected failure for', row.id, err);
    }

    return { scored: false, reason: 'scoring_failed', message };
  }

  const { result, model, version } = judged;

  /*
   * No cat, no score, and no allowance spent.
   *
   * The player did not take a bad photograph — they pointed the camera at something that
   * was not a cat. Charging a reveal for that would punish them for the app's own
   * detection being wrong, since a photo with no cat should not have got this far.
   *
   * The photograph is kept regardless. The shutter is free, deleting somebody's picture
   * because it disappointed a classifier is not ours to do, and the client offers the
   * deletion as a choice instead.
   */
  if (!result.isCat) {
    /*
     * Written down, so this verdict is reached exactly once per photograph.
     *
     * Without the stamp the row stays unscored, and unscored is the state that makes a
     * photo eligible for scoring — so every reveal would buy the same rejection again. The
     * `no_cat_at` check at the top of this function is what reads it back.
     */
    const { error: markError } = await supabase
      .from('photos')
      .update({ no_cat_at: new Date().toISOString() })
      .eq('id', row.id);

    if (markError) {
      // Logged, not raised. The player's answer is correct either way; what is lost is the
      // guard against them paying for it twice, and that is worth knowing about.
      console.error('[scoring] could not mark no-cat on', row.id, markError.message);
    }

    return {
      scored: false,
      reason: 'no_cat',
      message: 'We could not find a cat in that photo. Nothing was used up.',
    };
  }

  const total = totalOf(result.scores);

  const { data: updated, error } = await supabase
    .from('photos')
    .update({
      score_composition: result.scores.composition,
      score_pose_rarity: result.scores.poseRarity,
      score_cat_rarity: result.scores.catRarity,
      score_bonus: result.scores.bonus,
      score_total: total,
      tier: tierFor(total),
      pose: result.pose,
      badges: result.badges,
      traits: result.traits,
      scored_at: new Date().toISOString(),
      scoring_model: model,
      scoring_version: version,
      scoring_raw: result,
    })
    .eq('id', row.id)
    .select('*')
    .single<PhotoRow>();

  if (error || !updated) {
    /*
     * The model answered and the write did not land. Reported as a retryable failure rather
     * than a 500, because from where the player is standing it is the same event as the
     * model being unreachable — there is no score, the photo is safe, and pressing the
     * button again is the right thing to do.
     */
    console.error('[scoring] could not write score for', row.id, error?.message);

    return {
      scored: false,
      reason: 'scoring_failed',
      message: 'We could not save that score. Your photo is safe — try revealing it again.',
    };
  }

  /*
   * The reveal is spent here, and spending it is the last thing that happens.
   *
   * Ordered after the score is written so a failure cannot charge a player for a score they
   * did not get. The opposite order is the one that ruins somebody's day: ledger first, then
   * a failed update, and they have paid a reveal for a photo that is still unscored — and
   * because the allowance no longer reads `photos`, nothing would ever notice.
   *
   * The residual risk runs the harmless way. If this insert fails after the score landed,
   * the player keeps a score they were not charged for; that is a free reveal on a bad day
   * rather than a lost one, and it is logged.
   */
  const { error: ledgerError } = await supabase.from('reveals').insert({
    user_id: updated.owner_id,
    photo_id: updated.id,
    // The row's own timestamp, not a second `now()` — the photo and its ledger entry are
    // one event and should not disagree about when it happened.
    scored_at: updated.scored_at,
  });

  if (ledgerError) {
    console.error('[reveals] score written but not charged', updated.id, ledgerError.message);
  }

  return { scored: true, row: updated };
}

/**
 * Tier from the total.
 *
 * Mirrors the thresholds in the client's constants/game.ts, which describes itself as a
 * preview and says the server's answer is the one that counts. This is that answer.
 */
function tierFor(total: number): string {
  if (total >= 90) return 'Legendary';
  if (total >= 70) return 'Epic';
  if (total >= 50) return 'Rare';
  return 'Common';
}
