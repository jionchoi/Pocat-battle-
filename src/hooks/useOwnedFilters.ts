import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { shopApi } from '../api/endpoints';

/**
 * Which capture filters this player may use, or `null` while that is not yet known.
 *
 * ## Why this exists
 *
 * Until it did, the camera rail offered every filter to everybody. `game/shop.ts` gated two of
 * the three behind a rank and `ownsEntry` answered correctly — but nothing on the capture
 * screen ever asked it, so the gate was a row in a catalogue and nothing more. That was
 * harmless while filters could only be earned; it stopped being harmless the moment one could
 * be **bought with paws**, because a purchase that unlocks nothing is the player paying for a
 * button that was already there.
 *
 * ## Where the answer comes from
 *
 * The shop catalogue's `owned`, filtered to filters. Not a separate endpoint and not a second
 * copy of the rule: `owned` is `ownsEntry` evaluated server-side, which already folds together
 * the three ways to have something — rank, purchase, and (for Pro) the subscription. A client
 * that recomputed it from rank would be a second implementation of the gate, and would be
 * wrong the first time a filter was bought rather than earned.
 *
 * ## Refetched on every focus
 *
 * The camera is where a player goes straight after unlocking something in the shop, and the
 * filter they just paid for has to be there when they arrive. Focus is the moment that is
 * true — a mount-only fetch would miss it, because a stack screen is not unmounted when you
 * navigate off it (trap 12).
 *
 * ## Fail open, deliberately
 *
 * `null` means "not known yet", and the caller treats it as nothing locked. The alternative
 * locks every filter a player owns for the length of a request on every single camera open,
 * and locks them indefinitely on a bad connection. Against that, failing open costs one free
 * *preview* — the filters never reach the file or the score, see `constants/filters.ts`. That
 * is the cheapest possible thing to give away, and it is the right side to err on.
 *
 * The last answer is kept at module level so re-opening the camera starts from it rather than
 * from `null`. It lives for the session only; a cold launch asks again.
 */

let lastKnown: ReadonlySet<string> | null = null;

export function useOwnedFilters(): ReadonlySet<string> | null {
  const [owned, setOwned] = useState<ReadonlySet<string> | null>(lastKnown);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      shopApi
        .catalog()
        .then((catalog) => {
          const next = new Set(
            catalog.items
              .filter((item) => item.kind === 'filter' && item.owned)
              .map((item) => item.id)
          );

          lastKnown = next;
          if (alive) setOwned(next);
        })
        .catch(() => {
          // Keep whatever was last known. See "fail open" above — a failed read must not be
          // what locks a player out of a look they own.
        });

      return () => {
        alive = false;
      };
    }, [])
  );

  return owned;
}
