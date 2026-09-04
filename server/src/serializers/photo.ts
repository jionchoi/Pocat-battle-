import { publicUrlFor } from '../lib/storage.js';
import { emptyReactions } from '../game/community.js';
import type { TraitSet } from '../game/matching.js';

/**
 * Database rows to the shapes the app already reads.
 *
 * The client's `src/models/index.ts` is the contract, and it is deliberately not the same
 * as the schema: it is camelCase, it nests the score components, and it carries fields the
 * database computes rather than stores. Doing that translation in one file means a column
 * rename is a change here and nowhere else.
 */

export interface PhotoRow {
  id: string;
  owner_id: string;
  storage_path: string;
  caption: string | null;
  captured_at: string;
  captured_lat: number;
  captured_lng: number;
  cat_id: string | null;
  identified_at: string | null;
  score_composition: number | null;
  score_pose_rarity: number | null;
  score_cat_rarity: number | null;
  score_bonus: number | null;
  score_total: number | null;
  tier: string | null;
  pose: string | null;
  badges: string[];
  scored_at: string | null;
  shared_to_feed: boolean;
  showcased: boolean;
  shared_to_map: boolean;
  /*
   * The community layer, added by the 2026-08-12 migration.
   *
   * Optional on this type rather than required, because `serializePhoto` is used on rows
   * selected before the migration ran and on rows built in tests. Every read of them below
   * defaults, so a row without them serializes as a photograph nobody has reacted to — which
   * is what it is.
   */
  community_score?: number;
  view_count?: number;
  vote_count?: number;
  featured?: boolean;

  /**
   * Paws given by other players, added by the 2026-08-29 migration.
   *
   * Optional for the same reason the four above are, and it defaults to zero wherever it is
   * read. It is a display number and nothing else — it feeds no ranked value, so a row that
   * predates the column serializes as a photograph nobody has tipped, which is what it is.
   */
  paw_count?: number;

  /**
   * Who paid for the score, added by the 2026-08-31 migration.
   *
   * Equals `owner_id` on an ordinary reveal. Optional on this type for the same reason the
   * community counters are — rows selected before the column existed, and rows built in tests
   * — and null on a photograph scored before it, where the owner is the correct answer anyway.
   */
  revealed_by?: string | null;

  /** Set once the scorer reported no cat. While set, the model is never called again. */
  no_cat_at: string | null;
  scoring_attempts: number;
  /**
   * What the scoring call said the animal looks like.
   *
   * Kept on the row rather than only promoted onto the cat, so a later matching pass can
   * reconsider a photograph without paying to look at the image again. `{}` on anything
   * unscored, which is why every field of `TraitSet` is optional.
   */
  traits: TraitSet;
}

export function serializePhoto(
  row: PhotoRow,
  catNickname: string | null,
  /**
   * Who unlocked this score, when it was not the photographer.
   *
   * Passed in rather than looked up, exactly like `catNickname` and for the same reason: this
   * file translates rows and does not query. **Callers pass null for the ordinary case** —
   * their own reveal — because the screen has nothing to say about it. See `revealCreditFor`.
   */
  revealedBy: RevealCredit | null = null
) {

  return {
    id: row.id,
    ownerId: row.owner_id,
    imageUrl: publicUrlFor(row.storage_path),
    caption: row.caption ?? undefined,
    catId: row.cat_id ?? '',

    /*
     * Zeroes on an unscored photo, alongside `scoredAt: null`.
     *
     * The alternative is making `scores` optional on the model and teaching every card,
     * grid and breakdown in the app to render a maybe. `scoredAt` is the one field that
     * says whether the numbers mean anything, and it is the field the album checks before
     * it draws a score at all.
     */
    scores: {
      composition: row.score_composition ?? 0,
      poseRarity: row.score_pose_rarity ?? 0,
      catRarity: row.score_cat_rarity ?? 0,
      bonus: row.score_bonus ?? 0,
      total: row.score_total ?? 0,
    },
    scoredAt: row.scored_at,
    tier: (row.tier ?? 'Common') as 'Common' | 'Rare' | 'Epic' | 'Legendary',
    pose: (row.pose ?? 'unknown') as string,
    badges: row.badges,

    capturedAt: row.captured_at,
    capturedLocation: { lat: row.captured_lat, lng: row.captured_lng },

    /** Empty until the player confirms which cat this is. */
    catNickname: catNickname ?? '',
    identifiedAt: row.identified_at,

    sharedToFeed: row.shared_to_feed,
    showcased: row.showcased,

    /*
     * The coordinates go to the owner either way; this only says whether a pin goes to
     * anybody else.
     *
     * `capturedLocation` above is the exact pair, and it is correct to send it here because
     * every route using this serializer answers the photo's own owner. The map serializer is
     * a different file and a different audience, and it is the one that has to coarsen.
     */
    sharedToMap: row.shared_to_map,

    /*
     * Real now, where they used to be hard-coded zeroes waiting on the community migration.
     *
     * `reactions` and `myReaction` are still empty here and that is correct rather than
     * pending: this serializer answers a photo's own owner, in their album, where the
     * per-kind tallies are not drawn and the viewer's own reaction to their own photograph
     * is not a thing that exists — `ReactionBar` is disabled on your own work. The feed
     * serializer is the one that counts them, because it is the one that shows them.
     */
    voteCount: row.vote_count ?? 0,
    communityScore: row.community_score ?? 0,
    viewCount: row.view_count ?? 0,
    featured: row.featured ?? false,
    reactions: emptyReactions(),
    myReaction: null,

    /*
     * Sent to the owner too, unlike `reactions` above.
     *
     * The per-kind tallies are withheld here because the album does not draw them, but the
     * paw count is drawn on every photo surface there is — including your own, where it is
     * the one number on the card that says somebody else thought this was worth something.
     * Withholding it would draw a zero under a photograph that had been tipped a hundred
     * times.
     */
    pawCount: row.paw_count ?? 0,

    /*
     * Null whenever the photographer revealed their own score, which is nearly always.
     *
     * The absence is the message: a credit line reading "Unlocked by you" on your own
     * photograph is noise, and one on every historical row would imply something happened
     * that did not. Only a reveal somebody else paid for has anything to announce.
     */
    revealedBy,
  };
}

/** The credit line's shape. Just enough to name somebody and open their profile. */
export interface RevealCredit {
  id: string;
  username: string;
}

/**
 * Whether this row has a credit worth showing, and who it names.
 *
 * One rule in one place, called by both serializers, because "do not show the owner their own
 * name" is a presentation decision and the column deliberately records the owner's own reveals
 * too. Splitting it would mean the feed and the album could disagree about whether a
 * photograph was unlocked by somebody else.
 *
 * Null on three cases that all mean "nothing to say": unscored, revealed by its own owner, and
 * revealed before the column existed.
 */
export function revealCreditFor(
  row: PhotoRow,
  username: string | null
): RevealCredit | null {
  const by = row.revealed_by;

  if (!by || by === row.owner_id) return null;

  // A deleted account leaves `revealed_by` null through the foreign key, so reaching here with
  // no username means the profile row is missing rather than the reveal being unattributed.
  return { id: by, username: username ?? 'Someone' };
}
