import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { pawApi, type PawBalance, type PawBucket } from '../api/endpoints';
import { PAW_CONFIG } from '../constants/game';

/**
 * The player's paws, and what this device has given.
 *
 * ## Why the balance is here rather than on the profile
 *
 * It changes on every tap, from four different screens, and none of them own it. Hanging it
 * off `authStore` would mean a tap on a feed card writing into the object that holds the
 * session — and would tie refreshing a balance to refreshing an identity, which is a much
 * heavier thing to do on a tap.
 *
 * ## The two buckets are kept apart on purpose
 *
 * `grant` expires; `wallet` does not. The gift toast is the only place the difference is ever
 * explained — "6 left this week" versus "from your wallet" — so the store has to know which
 * one a gift came out of before the server answers, or the first sentence a player reads
 * about the economy would be a spinner. `spend` below makes that prediction, and it uses the
 * same rule the server does.
 *
 * **The server decides, always.** Nothing here can create a paw or authorise a gift; an
 * optimistic spend against a stale balance is refused server-side and rolled back. The worst
 * this state can do is word one toast wrongly.
 *
 * ## Persistence
 *
 * Written through to AsyncStorage, debounced, exactly like `reactionStore` — and for a
 * narrower reason. The balances are cached so the shop and the first tap after launch are not
 * blank while a request is in flight; they are refreshed from the server on launch and
 * overwritten by every gift response. Losing the blob degrades to "the shop shows a dash for
 * a moment", because the numbers that matter live on the server.
 */

const STORAGE_KEY = 'catframe.paws.v1';

/**
 * How many photographs' given-counts to remember.
 *
 * Smaller than `reactionStore`'s cap because it holds less: a reaction is a permanent state
 * this device wants to keep showing, where a given-count is a highlight on a card the player
 * tipped recently. Four thousand entries of it would be four thousand photographs somebody
 * gave a paw to, which is not a session.
 */
const MAX_TRACKED = 1_000;

export interface PawState {
  grant: { remaining: number; resetsAt: string | null };
  wallet: number;
  /**
   * How many paws this device has given each photo. Display only — it draws the paw button
   * as "you gave this one", the way the heart wears your reaction.
   */
  givenByPhotoId: Record<string, number>;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** Pulls the authoritative balance. Failures are silent — a stale balance still works. */
  refresh: () => Promise<void>;
  /** Replaces both balances with the server's answer. Never merged. */
  apply: (balance: PawBalance) => void;

  /**
   * Optimistically spends one paw and says which bucket it came from, or `null` when there
   * is nothing to spend.
   */
  spend: (photoId: string) => PawBucket | null;
  /**
   * Puts one back, into the bucket it came out of.
   *
   * **Not an undo.** There is no way for a player to take a gift back; this only ever runs
   * when the server *refused* a gift the client had already drawn optimistically, so nothing
   * was ever given and nothing is being reversed.
   */
  refund: (photoId: string, bucket: PawBucket) => void;

  given: (photoId: string) => number;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

interface Persisted {
  grant: { remaining: number; resetsAt: string | null };
  wallet: number;
  givenByPhotoId: Record<string, number>;
}

/** Debounced write-behind. A burst of taps costs one disk write, not one per tap. */
function persist(snapshot: Persisted): void {
  if (flushTimer) clearTimeout(flushTimer);

  flushTimer = setTimeout(() => {
    flushTimer = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => undefined);
  }, 1_500);
}

/**
 * Which bucket the next paw comes out of.
 *
 * A mirror of `chooseBucket` in `server/src/game/paws.ts`, and the server is the copy that
 * decides — this one exists so the gift toast can be worded in the same frame as the tap.
 * Grant first, always: grant paws expire and wallet paws do not, so there is exactly one
 * correct order and neither the player nor the client gets to pick a different one.
 */
function bucketFor(grantRemaining: number, wallet: number): PawBucket | null {
  if (grantRemaining > 0) return 'grant';
  if (wallet > 0) return 'wallet';
  return null;
}

export const usePawStore = create<PawState>((set, get) => ({
  /*
   * A full grant and an empty wallet before anything is known.
   *
   * Not zero-zero, which would draw "You are out of paws" over the first tap of a cold launch
   * — a refusal invented by the client for a player who has seven. Guessing high is the
   * forgiving direction: the server refuses an overdraw and the rollback puts the real number
   * on screen, where guessing low refuses a gift that would have succeeded.
   */
  grant: { remaining: PAW_CONFIG.grant, resetsAt: null },
  wallet: 0,
  givenByPhotoId: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Persisted>) : null;

      set({
        grant: parsed?.grant ?? get().grant,
        wallet: parsed?.wallet ?? 0,
        givenByPhotoId: parsed?.givenByPhotoId ?? {},
        hydrated: true,
      });
    } catch {
      // A corrupt blob is not worth failing a launch over — start from the defaults.
      set({ hydrated: true });
    }

    // The disk copy is a guess about money and is only there so nothing is blank. The
    // authoritative one is a request away, and it also settles the grant period server-side,
    // which is the whole reason the period needs no scheduled job.
    await get().refresh();
  },

  refresh: async () => {
    try {
      get().apply(await pawApi.balance());
    } catch {
      // Silent. A player who cannot reach the server has bigger problems than a stale
      // balance, and every gift is refused or confirmed by the server anyway.
    }
  },

  apply: (balance) => {
    set((state) => {
      const next: Persisted = {
        grant: { remaining: balance.grant.remaining, resetsAt: balance.grant.resetsAt },
        wallet: balance.wallet,
        givenByPhotoId: state.givenByPhotoId,
      };

      persist(next);
      return next;
    });
  },

  spend: (photoId) => {
    const state = get();
    const bucket = bucketFor(state.grant.remaining, state.wallet);

    if (!bucket) return null;

    const givenByPhotoId = { ...state.givenByPhotoId };
    givenByPhotoId[photoId] = (givenByPhotoId[photoId] ?? 0) + 1;

    const keys = Object.keys(givenByPhotoId);
    if (keys.length > MAX_TRACKED) {
      // Insertion order for string keys, so the front is the oldest. Dropping them loses only
      // the "you gave this one" highlight on photos this device tipped a thousand cards ago.
      for (const key of keys.slice(0, keys.length - MAX_TRACKED)) delete givenByPhotoId[key];
    }

    const next: Persisted = {
      grant: {
        ...state.grant,
        remaining: bucket === 'grant' ? state.grant.remaining - 1 : state.grant.remaining,
      },
      wallet: bucket === 'wallet' ? Math.max(0, state.wallet - 1) : state.wallet,
      givenByPhotoId,
    };

    persist(next);
    set(next);

    return bucket;
  },

  refund: (photoId, bucket) => {
    set((state) => {
      const givenByPhotoId = { ...state.givenByPhotoId };
      const remainingGiven = (givenByPhotoId[photoId] ?? 0) - 1;

      if (remainingGiven > 0) givenByPhotoId[photoId] = remainingGiven;
      else delete givenByPhotoId[photoId];

      const next: Persisted = {
        grant: {
          ...state.grant,
          /*
           * Capped at the grant size, matching the server.
           *
           * A refused gift in the last seconds of a period, rolled back just after the
           * period turns, meets a grant that has already refilled — adding to it would show
           * an eighth paw that the server will not agree exists.
           */
          remaining:
            bucket === 'grant'
              ? Math.min(PAW_CONFIG.grant, state.grant.remaining + 1)
              : state.grant.remaining,
        },
        wallet: bucket === 'wallet' ? state.wallet + 1 : state.wallet,
        givenByPhotoId,
      };

      persist(next);
      return next;
    });
  },

  given: (photoId) => get().givenByPhotoId[photoId] ?? 0,
}));
