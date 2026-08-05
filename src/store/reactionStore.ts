import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { Reaction } from '../models';

/**
 * This device's own reactions, by photo id.
 *
 * ## Why the client owns this
 *
 * The viral feed is served from a cache that is shared by every reader and, above that, by
 * a CDN. That is only possible because the payload is byte-identical for everyone — one
 * per-viewer field in it and the whole tier collapses back into a per-user response.
 *
 * `myReaction` was that field. It is also the one piece of the payload the reader already
 * knows, because it is a record of their own tap. So it moves here: the server ships the
 * public numbers, this store supplies the personal bit, and the two are merged at render.
 *
 * The alternative — a second authenticated request returning "which of these 24 did I
 * react to" — would work and is what to reach for when this state needs to follow a user
 * across devices. It costs a round trip per page to answer a question the device can
 * answer from memory, so it is not what runs now.
 *
 * ## Persistence
 *
 * Written through to AsyncStorage, debounced, so reactions survive a restart. Losing it
 * degrades to "reaction buttons look untapped until you tap one" — the server still holds
 * the authoritative `Vote` row and rejects a double count, so the failure mode is cosmetic
 * rather than a way to react twice.
 */

const STORAGE_KEY = 'catsnap.reactions.v1';

/** Bounded so a heavy scroller's history cannot grow without limit. */
const MAX_TRACKED = 4_000;

interface ReactionState {
  byPhotoId: Record<string, Reaction>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Applies the server's answer for one photo. `null` clears it. */
  set: (photoId: string, reaction: Reaction | null) => void;
  get: (photoId: string) => Reaction | null;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced write-behind, for the same reason the server has one: a burst of taps should
 * cost one disk write, not one per tap. AsyncStorage is a serialized bridge call on the JS
 * thread, and writing on every tap is visible as jank while scrolling a feed.
 */
function persist(byPhotoId: Record<string, Reaction>): void {
  if (flushTimer) clearTimeout(flushTimer);

  flushTimer = setTimeout(() => {
    flushTimer = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(byPhotoId)).catch(() => undefined);
  }, 1_500);
}

export const useReactionStore = create<ReactionState>((set, get) => ({
  byPhotoId: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, Reaction>) : {};
      set({ byPhotoId: parsed, hydrated: true });
    } catch {
      // A corrupt blob is not worth failing a launch over — start empty.
      set({ byPhotoId: {}, hydrated: true });
    }
  },

  set: (photoId, reaction) => {
    set((state) => {
      const next = { ...state.byPhotoId };

      if (reaction === null) delete next[photoId];
      else next[photoId] = reaction;

      const keys = Object.keys(next);
      if (keys.length > MAX_TRACKED) {
        // Object key order is insertion order for string keys, so the oldest entries are
        // at the front. Dropping them loses only the tapped-state highlight on photos this
        // device has not seen in thousands of scrolls.
        for (const key of keys.slice(0, keys.length - MAX_TRACKED)) delete next[key];
      }

      persist(next);
      return { byPhotoId: next };
    });
  },

  get: (photoId) => get().byPhotoId[photoId] ?? null,
}));

/**
 * Merges this device's reactions into a page of photos.
 *
 * Kept as a plain function rather than a hook so it can run inside the same `useMemo` that
 * packs the masonry — the overlay is derived data, and recomputing it on every render of a
 * scrolling list would be exactly the kind of per-frame work the feed is built to avoid.
 */
export function withMyReactions<T extends { id: string; myReaction: Reaction | null }>(
  photos: T[],
  byPhotoId: Record<string, Reaction>
): T[] {
  return photos.map((photo) => {
    const mine = byPhotoId[photo.id] ?? null;
    return mine === photo.myReaction ? photo : { ...photo, myReaction: mine };
  });
}
