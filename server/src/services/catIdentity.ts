import { supabase } from '../lib/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { serializePhoto, type PhotoRow } from '../serializers/photo.js';
import { serializeCat, type CatRow, type DexEntryRow } from '../serializers/cat.js';
import { SEARCH_RADIUS_M, distanceM } from '../game/matching.js';
import { ownEncountersFor, promoteBestPhoto } from './catDex.js';
import { ownedPhoto } from './photos.js';

/**
 * Confirming which cat a photograph is of.
 *
 * The write side of identity. `catMatching.ts` produces a shortlist and this records the
 * player's answer — and the answer is always a player's, never a model's. Nothing here is
 * ever reached automatically.
 *
 * Costs nothing to run. Every input is already on rows we hold, which is what makes
 * re-identifying free and therefore something a player may do as often as they like.
 *
 * ## No transaction
 *
 * PostgREST gives no way to wrap these writes in one, so the steps are ordered by what a
 * failure between them would leave behind. The photograph moves first and the bookkeeping
 * follows, so an interruption leaves a photo attached to a cat whose Dex entry is a little
 * behind — which is a state the rest of the code already treats as ordinary, because
 * `nicknamesFor` is explicitly documented to tolerate a photo whose cat this player has no
 * entry for. The reverse order would leave an entry claiming an encounter that no photograph
 * supports, and nothing repairs that.
 */

export type IdentifyInput = { catId: string } | { newCat: { nickname: string } };

/* -------------------------------------------------------------------------- */
/* Identify                                                                   */
/* -------------------------------------------------------------------------- */

export async function identify(userId: string, photoId: string, input: IdentifyInput) {
  const photo = await ownedPhoto(userId, photoId);

  const target =
    'catId' in input
      ? await existingCat(input.catId)
      : await createCat(userId, photo, input.newCat.nickname);

  /*
   * Already the answer being given.
   *
   * Idempotent rather than a 409, because the request that gets here twice is almost always
   * one request retried over a flaky connection, and refusing the second half of somebody's
   * network problem tells them their correction failed when it landed.
   */
  if (photo.cat_id === target.cat.id) {
    return respond(userId, photo, target.cat, null, false);
  }

  const previousCatId = photo.cat_id;

  /*
   * Both columns, together. `photos_identified_together` rejects a row carrying one without
   * the other, so this is the schema making a half-identified photo unrepresentable rather
   * than something to remember.
   */
  const { data: moved, error } = await supabase
    .from('photos')
    .update({ cat_id: target.cat.id, identified_at: new Date().toISOString() })
    .eq('id', photo.id)
    .eq('owner_id', userId)
    .select('*')
    .maybeSingle<PhotoRow>();

  if (error) throw error;
  // An UPDATE matching no rows is a success in Postgres. `ownedPhoto` proved it existed;
  // this catches it being deleted in between.
  if (!moved) throw new HttpError(404, 'That photo is not in your album.');

  if (previousCatId) await leaveCat(userId, previousCatId, photo.id);
  await joinCat(userId, target.cat, moved);

  return respond(userId, moved, target.cat, previousCatId, target.created);
}

/* -------------------------------------------------------------------------- */
/* The cat being joined                                                       */
/* -------------------------------------------------------------------------- */

async function existingCat(catId: string): Promise<{ cat: CatRow; created: boolean }> {
  const { data, error } = await supabase
    .from('cats')
    .select('id, discovered_by, default_nickname, first_seen_lat, first_seen_lng, last_seen_lat, last_seen_lng, last_seen_at')
    .eq('id', catId)
    .maybeSingle<CatRow>();

  if (error) throw error;
  if (!data) throw new HttpError(404, 'We could not find that cat.');

  return { cat: data, created: false };
}

/**
 * A cat nobody has recorded before.
 *
 * Its description and its location are promoted straight off the photograph — which is why
 * the request carries nothing but a name. The traits came from the scoring call, so a cat
 * created from an unscored photo starts undescribed and gets nothing but proximity to
 * recommend it next time. That is honest rather than a gap: nothing has looked at it yet.
 *
 * The name becomes `default_nickname`, the cat's name for *everyone*, rather than this
 * player's private label. Whoever finds an animal first gets to name it, and any other player
 * who later photographs the same cat may still set their own nickname on their own entry.
 */
async function createCat(
  userId: string,
  photo: PhotoRow,
  nickname: string
): Promise<{ cat: CatRow; created: boolean }> {
  const traits = photo.traits ?? {};

  const { data, error } = await supabase
    .from('cats')
    .insert({
      discovered_by: userId,
      default_nickname: nickname,
      coat_pattern: traits.coatPattern ?? null,
      primary_color: traits.primaryColor ?? null,
      secondary_color: traits.secondaryColor ?? null,
      eye_color: traits.eyeColor ?? null,
      markings: traits.markings ?? [],
      first_seen_lat: photo.captured_lat,
      first_seen_lng: photo.captured_lng,
      last_seen_lat: photo.captured_lat,
      last_seen_lng: photo.captured_lng,
      last_seen_at: photo.captured_at,
    })
    .select('id, discovered_by, default_nickname, first_seen_lat, first_seen_lng, last_seen_lat, last_seen_lng, last_seen_at')
    .single<CatRow>();

  if (error || !data) throw error ?? new HttpError(500, 'We could not add that cat.');

  return { cat: data, created: true };
}

/* -------------------------------------------------------------------------- */
/* Joining and leaving                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Records that this player has met this cat, once more than before.
 *
 * The entry is per player, so a cat somebody else discovered years ago is still encounter
 * number one for whoever is meeting it today. That is the whole reason `cat_dex_entries` is
 * separate from `cats`.
 */
async function joinCat(userId: string, cat: CatRow, photo: PhotoRow): Promise<void> {
  const existing = await entryFor(userId, cat.id);

  const entryId = existing
    ? await bumpEntry(existing, photo)
    : await createEntry(userId, cat.id, photo);

  await touchCat(cat, photo);

  // A photograph was added, so a hand-set pin still outranks it — see `promoteBestPhoto`.
  await promoteBestPhoto(userId, entryId, cat.id, { releasePin: false });
}

async function bumpEntry(entry: DexEntryRow, photo: PhotoRow): Promise<string> {
  const { error } = await supabase
    .from('cat_dex_entries')
    .update({
      encounter_count: entry.encounter_count + 1,
      // Only ever forward. Identifying a photograph from last month must not tell the Dex
      // this cat was seen last month when it was seen yesterday.
      last_seen_at: laterOf(entry.last_seen_at, photo.captured_at),
    })
    .eq('id', entry.id);

  if (error) throw error;

  return entry.id;
}

async function createEntry(
  userId: string,
  catId: string,
  photo: PhotoRow
): Promise<string> {
  const { data, error } = await supabase
    .from('cat_dex_entries')
    .insert({
      user_id: userId,
      cat_id: catId,
      // `encounter_count` defaults to 1 and the check constraint requires at least that, which
      // is the schema agreeing that an entry exists because a meeting happened.
      first_seen_at: photo.captured_at,
      last_seen_at: photo.captured_at,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) throw error ?? new HttpError(500, 'We could not add that cat to your Dex.');

  return data.id;
}

/**
 * Undoes one encounter, because the photograph that made it was of a different animal.
 *
 * The only place `encounter_count` ever falls. Deleting a photograph deliberately does not —
 * a deleted photograph was still a cat you met — but a *misidentified* one was never an
 * encounter with this cat at all, so removing it is a correction rather than a loss.
 *
 * At one, the entry goes entirely. `cat_dex_entries_encounters_positive` will not accept a
 * zero, and it is right not to: an entry is a record of having met an animal, and the last
 * evidence that this player ever met this one has just turned out to be a photograph of
 * something else. A Dex should not list a cat its owner never photographed.
 */
async function leaveCat(userId: string, catId: string, photoId: string): Promise<void> {
  const entry = await entryFor(userId, catId);
  // No entry to correct. Possible if an earlier identify was interrupted between moving the
  // photograph and writing the entry — see the note at the top about ordering.
  if (!entry) return;

  if (entry.encounter_count <= 1) {
    const { error } = await supabase.from('cat_dex_entries').delete().eq('id', entry.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('cat_dex_entries')
    .update({ encounter_count: entry.encounter_count - 1 })
    .eq('id', entry.id);

  if (error) throw error;

  /*
   * The tile pointed at the photograph that just left. It is now a picture of another animal
   * sitting on this cat's card, so the pin has to be released whether or not the player set
   * it by hand — the photograph they chose is no longer a photograph of this cat.
   */
  if (entry.best_photo_id === photoId) {
    await promoteBestPhoto(userId, entry.id, catId, { releasePin: true });
  }
}

/**
 * Moves the shared record of where this cat was last seen.
 *
 * Two guards, because this is the one write here that touches a row every other player reads.
 *
 * Time — identifying is not capturing. A player can attach a photograph taken weeks ago, and
 * letting that drag `last_seen_*` backwards would move the cat's territory to where it used
 * to be and quietly spoil everyone's shortlist.
 *
 * Distance — nothing stops a client naming any cat id at all, including one on the other side
 * of the world, and without this that request would teleport a stranger's cat to the caller's
 * street. Every legitimate identification comes off a shortlist that was already filtered by
 * proximity, so a cat further away than the matcher would ever have offered is a claim this
 * refuses to publish.
 *
 * The cost is a cat that genuinely relocates further than the search radius: its shared record
 * stays where it was, and it stops being shortlisted near its new home. That is recoverable —
 * the players there record it as a new cat — and it is the safer failure. The alternative is
 * one request being able to move an animal anybody else is tracking.
 */
async function touchCat(cat: CatRow, photo: PhotoRow): Promise<void> {
  if (new Date(photo.captured_at) <= new Date(cat.last_seen_at)) return;

  const drift = distanceM(
    photo.captured_lat,
    photo.captured_lng,
    cat.last_seen_lat,
    cat.last_seen_lng
  );

  if (drift > SEARCH_RADIUS_M) return;

  const { error } = await supabase
    .from('cats')
    .update({
      last_seen_lat: photo.captured_lat,
      last_seen_lng: photo.captured_lng,
      last_seen_at: photo.captured_at,
    })
    .eq('id', cat.id);

  if (error) throw error;
}

/** Timestamps as the database hands them over, compared as instants rather than as strings. */
function laterOf(a: string, b: string): string {
  return new Date(b) > new Date(a) ? b : a;
}

async function entryFor(userId: string, catId: string): Promise<DexEntryRow | null> {
  const { data, error } = await supabase
    .from('cat_dex_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('cat_id', catId)
    .maybeSingle<DexEntryRow>();

  if (error) throw error;

  return data;
}

/* -------------------------------------------------------------------------- */
/* The reply                                                                  */
/* -------------------------------------------------------------------------- */

async function respond(
  userId: string,
  photo: PhotoRow,
  cat: CatRow,
  releasedCatId: string | null,
  created: boolean
) {
  const entry = await entryFor(userId, cat.id);

  if (!entry) throw new HttpError(500, 'We saved that, but could not read your Dex back.');

  /*
   * The same `OwnEncounters` the Dex endpoints build, from the same function.
   *
   * This used to be a private copy here. Two implementations of "what do this player's
   * photographs say about this cat" would answer the same question in two places, and the
   * subtle half of it — that the first sighting must come from the player's own captures and
   * never from `cats.first_seen_*`, which belong to whoever discovered the animal — is
   * exactly the kind of reasoning that survives in one copy and gets lost from the other.
   */
  const own = await ownEncountersFor(userId, [entry]);

  return {
    photo: serializePhoto(photo, entry.nickname ?? cat.default_nickname),
    cat: serializeCat(
      entry,
      cat,
      own.get(cat.id) ?? { photoCount: 0, bestPhotoPath: null, firstSeenLocation: null },
      userId
    ),
    created,
    releasedCatId,
  };
}
