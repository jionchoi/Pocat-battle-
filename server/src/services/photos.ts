import { supabase } from '../lib/supabase.js';
import { scorePhoto } from '../lib/openai.js';
import { assertOwnedPath, deletePhotoObject, downloadPhoto } from '../lib/storage.js';
import { HttpError } from '../middleware/errorHandler.js';
import { REVEAL_LIMITS, REVEAL_WINDOW_HOURS, totalOf } from '../game/scoring.js';
import { serializePhoto, type PhotoRow } from '../serializers/photo.js';

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
 * Counted from `photos.scored_at` rather than from a ledger. The rows already record when
 * every score happened, so a separate table would be a second copy of that fact — and the
 * two would eventually disagree, at which point the leaderboard is being rationed by
 * whichever one the code happened to read.
 *
 * The window rolls. There is no midnight to wait for and no timezone to argue about, and
 * moving the device clock forward buys nothing because the comparison happens here.
 */
export async function revealAllowance(userId: string): Promise<RevealAllowance> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('pro_subscription_active')
    .eq('id', userId)
    .single();

  const limit = profile?.pro_subscription_active ? REVEAL_LIMITS.pro : REVEAL_LIMITS.free;

  const since = new Date(Date.now() - REVEAL_WINDOW_HOURS * 3600_000).toISOString();

  const { data, error } = await supabase
    .from('photos')
    .select('scored_at')
    .eq('owner_id', userId)
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

/* -------------------------------------------------------------------------- */
/* Capture                                                                    */
/* -------------------------------------------------------------------------- */

export interface CaptureInput {
  userId: string;
  storagePath: string;
  lat: number;
  lng: number;
  capturedAt?: string;
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
    return { photo: serializePhoto(row, null), allowance, scored: false };
  }

  const scoredRow = await applyScore(row);

  return {
    photo: serializePhoto(scoredRow, null),
    allowance: await revealAllowance(input.userId),
    scored: true,
  };
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
  const { data: row, error } = await supabase
    .from('photos')
    .select('*')
    .eq('id', photoId)
    .eq('owner_id', userId)
    .single<PhotoRow>();

  if (error || !row) throw new HttpError(404, 'That photo is not in your album.');

  if (row.scored_at) {
    throw new HttpError(409, 'That photo already has a score.');
  }

  const allowance = await revealAllowance(userId);

  if (allowance.remaining !== null && allowance.remaining <= 0) {
    throw new HttpError(429, 'You have used your scores for now. Another one frees up soon.');
  }

  const scoredRow = await applyScore(row);

  return {
    photo: serializePhoto(scoredRow, null),
    allowance: await revealAllowance(userId),
  };
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fetches the image, judges it, and writes the verdict.
 *
 * Every score column is written in one update, because the schema will not accept a photo
 * that is half scored — a check constraint requires the components, the total, the tier,
 * the pose and the model to arrive together or not at all.
 *
 * Nothing here adjusts the model's numbers. `totalOf` sums the components it returned, and
 * that is the only arithmetic in the pipeline.
 */
async function applyScore(row: PhotoRow): Promise<PhotoRow> {
  const image = await downloadPhoto(row.storage_path);
  const { result, model, version } = await scorePhoto(image);

  /*
   * No cat, no score, and no allowance spent.
   *
   * The player did not take a bad photograph — they pointed the camera at something that
   * was not a cat. Charging a reveal for that would punish them for the app's own
   * detection being wrong, since a photo with no cat should not have got this far.
   */
  if (!result.isCat) {
    throw new HttpError(422, 'We could not find a cat in that photo. Nothing was used up.');
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

  if (error || !updated) throw error ?? new HttpError(500, 'We could not save that score.');

  return updated;
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
