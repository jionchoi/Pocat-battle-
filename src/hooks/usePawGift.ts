import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';

import { pawApi, type PawBucket } from '../api/endpoints';
import { showToast } from '../components/Toast';
import { PAW_CONFIG } from '../constants/game';
import { isPlaceholderId } from '../constants/placeholders';
import type { Photo } from '../models';
import { usePawStore } from '../store/pawStore';

/**
 * Giving a paw, wherever the photograph is being shown.
 *
 * Shaped like `usePhotoReaction` and for the same reason: the feed, the challenge standings
 * and Photo Detail hold their photos in three different containers, so the hook owns the
 * *rules* and the caller owns the storage. `update` takes an id and a pure updater.
 *
 * ## Optimistic, with the toast as the receipt
 *
 * Giving spends currency, so it cannot be a bare tap with no feedback — but a confirm dialog
 * on every paw would kill the volume the gesture needs, and a currency nobody spends is not a
 * currency. So the tap lands immediately and a toast carries the consequence:
 *
 *     1 paw given · 6 left this week
 *     1 paw given · from your wallet
 *
 * That wording is the only place the two buckets are ever explained, which is deliberate —
 * nothing has to be taught up front, because the first sentence a player reads about paws
 * arrives at the moment it is about to matter. The second line only ever appears once the
 * weekly grant is gone, so the difference introduces itself exactly when it becomes real.
 *
 * ## The toast has nothing to press, because a gift is final
 *
 * This carried an Undo for its first draft and it was cut. A paw that can be taken back is not
 * a gift — the recipient would watch counts go down as an ordinary event, and "somebody liked
 * this" would mean "for now". The cost is that a mis-tap is unrecoverable, which is a real
 * cost and an acceptable one at one paw; it is exactly why the toast still fires with nothing
 * to press. The player is told what they spent and what is left, even though nothing can be
 * done about it. See `server/src/game/paws.ts`.
 *
 * ## The bucket is predicted, then overwritten
 *
 * The toast has to say "6 left this week" in the same frame as the tap, so the store guesses
 * which bucket the paw came out of using the same grant-first rule the server applies. The
 * server's answer then **replaces** both balances rather than being merged into them —
 * merging two sources of truth for one integer is how balances start drifting, and this
 * integer is money.
 *
 * A failure rolls the counts back to exactly what they were. That is not an undo — nothing was
 * given — it is the optimistic guess being withdrawn because the server refused it.
 */
export function usePawGift<T extends Photo>(
  update: (photoId: string, apply: (photo: T) => T) => void
) {
  const navigation = useNavigation();

  return useCallback(
    (photo: T) => {
      const store = usePawStore.getState();
      const bucket = store.spend(photo.id);

      if (!bucket) {
        /*
         * Out of both. The route to the shop is the point of this toast — a refusal with
         * nowhere to go is a dead end, and the shop is where paws will be bought.
         *
         * `initial: false` is trap 11: without it the profile stack holds `[Shop]` instead of
         * `[Profile, Shop]`, so back does nothing and pressing the Profile tab reopens the
         * shop. It cost three separate bug reports on the map tab.
         */
        showToast('You are out of paws.', 'neutral', {
          action: {
            label: 'Shop',
            onPress: () =>
              navigation.navigate('MainTabs', {
                screen: 'ProfileTab',
                params: { screen: 'Shop', initial: false },
              }),
          },
          durationMs: PAW_CONFIG.giftToastMs,
        });
        return;
      }

      const previousCount = photo.pawCount;

      update(photo.id, (p) => ({ ...p, pawCount: (p.pawCount ?? 0) + 1 }));

      /*
       * A design placeholder has no row behind it, so there is nothing to confirm.
       *
       * The optimistic update is the whole interaction — the count moves and stays moved, and
       * the toast still teaches the two buckets, which is what the placeholder feed is for.
       * Posting it would answer 404 and roll the tap back out with an error, making the paw
       * look broken on the one screen built to show it working. Same guard as
       * `usePhotoReaction` and `usePhotoImpressions`. See `constants/placeholders`.
       */
      if (isPlaceholderId(photo.id)) {
        showToast(givenMessage(bucket), 'success', { durationMs: PAW_CONFIG.giftToastMs });
        return;
      }

      pawApi
        .give(photo.id)
        .then((result) => {
          update(photo.id, (p) => ({ ...p, pawCount: result.pawCount }));
          usePawStore.getState().apply(result.balance);

          /*
           * The toast is worded from the *server's* bucket and the server's remaining count,
           * not from the prediction above. They agree in every ordinary case; when they do
           * not — a second device spent the last grant paw a moment ago — the sentence the
           * player reads is the true one.
           */
          showToast(givenMessage(result.bucket, result.balance.grant.remaining), 'success', {
            durationMs: PAW_CONFIG.giftToastMs,
          });
        })
        .catch((err: unknown) => {
          usePawStore.getState().refund(photo.id, bucket);
          update(photo.id, (p) => ({ ...p, pawCount: previousCount }));

          /*
           * The server's own message is used when it sent one, because the two refusals it
           * can give — your own photo, and an empty balance — are both things the player can
           * act on, and a generic "we could not do that" throws away which one happened.
           */
          const message =
            err instanceof Error && err.message ? err.message : 'We could not give that paw.';
          showToast(message, 'error');

          // Whatever the server thinks is true is worth re-reading after a refusal: an empty
          // balance means the local guess was wrong, and it should stop being wrong now.
          void usePawStore.getState().refresh();
        });
    },
    [navigation, update]
  );
}

/**
 * What the confirmation toast says.
 *
 * Two sentences, and the difference between them is the entire explanation of the economy:
 * while the weekly grant lasts, the player is told what is left of it; once it is gone, they
 * are told the paw came from somewhere that does not refill on its own. Nobody has to be
 * taught the word "bucket".
 *
 * `remaining` is omitted on the placeholder path, where there is no server to have counted —
 * the store's own prediction is used instead, which is what the tap actually spent.
 */
function givenMessage(bucket: PawBucket, remaining?: number): string {
  if (bucket === 'wallet') return '1 paw given · from your wallet';

  const left = remaining ?? usePawStore.getState().grant.remaining;
  return `1 paw given · ${left} left this week`;
}
