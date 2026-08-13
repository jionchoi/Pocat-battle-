import { publicUrlFor } from '../lib/storage.js';
import type { PhotoRow } from './photo.js';
import type { Reaction } from '../game/community.js';

/**
 * A photograph as a stranger sees it.
 *
 * The third audience, after the album's owner and the map's readers, and it is its own file
 * for the same reason `sighting.ts` is: what may be emitted depends on who is reading, and
 * a serializer that tried to serve everybody would eventually serve the wrong one.
 *
 * ## What is deliberately absent
 *
 * `capturedLocation` sends **zeroes**, not the real pair. A feed card has no map on it and
 * nothing in `FeedPost` or `ViralCard` reads the field — it is present only because the
 * client's `Photo` type requires it. Sending the true coordinates to every reader of a public
 * feed would undo the map's coarsening completely, and by a much easier route: no bounding
 * box, no rate limit, just scroll.
 *
 * `sharedToMap` and `showcased` go out as they are; both are already-published facts about a
 * photo the owner chose to share. `caption`, `badges` and the score are the content.
 */

export interface AuthorRow {
  id: string;
  username: string | null;
  avatar_url: string | null;
  rank: number | null;
}

export interface FeedCounts {
  reactions: Record<Reaction, number>;
  /** The reader's own reaction, and always null on the anonymous ranked feed. */
  myReaction: Reaction | null;
}

export function serializeFeedPhoto(
  row: PhotoRow,
  author: AuthorRow | null,
  counts: FeedCounts,
  catNickname: string | null
) {

  return {
    id: row.id,
    ownerId: row.owner_id,
    imageUrl: publicUrlFor(row.storage_path),
    caption: row.caption ?? undefined,
    catId: row.cat_id ?? '',

    /*
     * Zeroes beside a null `scoredAt`, exactly as the album serializer does — and the roadmap
     * called this out as the thing to get right here: the feed card must read `scoredAt`
     * rather than trusting these, because a shared photo can be published long before it is
     * judged. Sharing is not gated on a reveal, on purpose, so this is the common case rather
     * than an edge one.
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

    /*
     * Not the real coordinates. See the note at the top — a public feed is the widest audience
     * in the product and the cheapest possible way to harvest positions.
     */
    capturedLocation: { lat: 0, lng: 0 },

    catNickname: catNickname ?? '',
    identifiedAt: row.identified_at,

    sharedToFeed: row.shared_to_feed,
    showcased: row.showcased,
    sharedToMap: row.shared_to_map,

    voteCount: row.vote_count ?? 0,
    communityScore: row.community_score ?? 0,
    viewCount: row.view_count ?? 0,
    featured: row.featured ?? false,
    reactions: counts.reactions,
    myReaction: counts.myReaction,

    /*
     * Empty rather than absent when the account is gone or never finished setup.
     *
     * `PhotoWithAuthor.author` is not optional in the contract, and a card that crashed on a
     * deleted account would take the whole feed page down with it — one bad row silently
     * costing thirty good ones is the worst available failure here.
     */
    author: {
      id: author?.id ?? row.owner_id,
      username: author?.username ?? 'Someone',
      avatarUrl: author?.avatar_url ?? '',
      photographerRank: author?.rank ?? 1,
    },
  };
}
