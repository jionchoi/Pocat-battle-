import { useCallback } from 'react';

import { photoApi } from '../api/endpoints';
import { showToast } from '../components/Toast';
import { REACTIONS } from '../constants/game';
import { isPlaceholderId } from '../constants/placeholders';
import type { Photo, Reaction } from '../models';
import { useReactionStore } from '../store/reactionStore';

/**
 * Reacting to a photo, wherever it is being shown.
 *
 * The feed and Photo Detail both need this and hold their photos in different shapes —
 * one an array of `PhotoWithAuthor`, the other a single `Photo` in state — so the hook
 * owns the *rules* and the caller owns the storage. `update` receives an id and a pure
 * updater; how it finds and replaces that photo is the caller's business.
 *
 * ## Optimistic, and deliberately so
 *
 * The tap has to register in the same frame or the button feels broken. The server is the
 * authority on the resulting counts either way, so its response **overwrites** the guess
 * rather than being merged into it — merging two sources of truth for the same integer is
 * how counts start drifting.
 *
 * A failure rolls the counts back to exactly what they were, which is simpler and more
 * correct than trying to unwind one field.
 *
 * ## Where "my reaction" lives
 *
 * Not on the photo. The feed is served from a cache shared by every reader, so the payload
 * carries no viewer — `reactionStore` supplies that half and is read here rather than from
 * whatever the caller happens to be holding. Keeping one source for it is what stops the
 * button and the feed disagreeing after a round trip. See the note in `reactionStore`.
 */
export function usePhotoReaction<T extends Photo>(
  update: (photoId: string, apply: (photo: T) => T) => void
) {
  const setMyReaction = useReactionStore((s) => s.set);

  return useCallback(
    (photo: T, reaction: Reaction) => {
      const held = useReactionStore.getState().get(photo.id);
      const clearing = held === reaction;

      const previousCounts = photo.reactions;
      const previousVotes = photo.voteCount;

      // Tapping a different reaction replaces the held one; tapping the held one clears
      // it. The server enforces the same rule, so the counts cannot be inflated by
      // tapping every option in turn.
      /*
       * Every key is filled in, not just the ones the payload happened to carry.
       *
       * The reaction set grew from three to five, and a photo whose row predates that — or a
       * server one deploy behind this client — answers with three keys. `counts[reaction] += 1`
       * on a missing key produces `NaN`, which then renders as "NaN" in the summary and
       * poisons the total. Normalising first costs one pass over five strings and makes the
       * arithmetic below independent of what the server sent.
       */
      const counts = REACTIONS.reduce(
        (acc, key) => {
          acc[key] = photo.reactions[key] ?? 0;
          return acc;
        },
        {} as Record<Reaction, number>
      );

      if (held) counts[held] = Math.max(0, counts[held] - 1);
      if (!clearing) counts[reaction] += 1;

      const total = (tallies: Record<Reaction, number>) =>
        REACTIONS.reduce((sum, key) => sum + (tallies[key] ?? 0), 0);

      update(photo.id, (p) => ({ ...p, reactions: counts, voteCount: total(counts) }));
      setMyReaction(photo.id, clearing ? null : reaction);

      /*
       * A design placeholder has no row behind it, so there is nothing to confirm.
       *
       * The optimistic update above is the whole interaction: the tap registers, the counts
       * move, and it stays that way. Posting it would answer 404 and roll the tap straight
       * back out with an error toast, which makes the reaction bar look broken on the one
       * screen built to show it working. See `constants/placeholders`.
       */
      if (isPlaceholderId(photo.id)) return;

      photoApi
        .vote(photo.id, reaction)
        .then((result) => {
          update(photo.id, (p) => ({
            ...p,
            reactions: result.reactions,
            voteCount: total(result.reactions),
            communityScore: result.communityScore,
            viewCount: result.viewCount,
          }));
          setMyReaction(photo.id, result.myReaction);
        })
        .catch(() => {
          update(photo.id, (p) => ({
            ...p,
            reactions: previousCounts,
            voteCount: previousVotes,
          }));
          setMyReaction(photo.id, held);
          showToast('We could not record that reaction.', 'error');
        });
    },
    [setMyReaction, update]
  );
}
