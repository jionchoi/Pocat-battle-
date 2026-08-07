import { publicUrlFor } from '../lib/storage.js';

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
}

export function serializePhoto(row: PhotoRow, catNickname: string | null) {
  const scored = row.scored_at !== null;

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
     * The community layer does not exist yet — no votes table, no view counts. These are
     * the shapes the client's type demands, held at their empty values until the feed
     * migration gives them somewhere to come from.
     */
    voteCount: 0,
    communityScore: 0,
    viewCount: 0,
    featured: false,
    reactions: { laugh: 0, love: 0, wow: 0 },
    myReaction: null,

    // Set to true only on a photo scored by this request, so the reveal knows to animate.
    isScoredNow: scored,
  };
}
