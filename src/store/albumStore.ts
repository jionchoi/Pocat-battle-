import { create } from 'zustand';

import { ApiRequestError } from '../api/client';
import { albumApi, catdexApi, photoApi } from '../api/endpoints';
import { ALBUM_CONFIG } from '../constants/game';
import type { Cat, IdentifyChoice, Identification, Photo, Rarity } from '../models';
import { readPhotos, replacePhotos, deletePhoto as deleteLocalPhoto, writePhoto } from '../services/database';
import { useAuthStore } from './authStore';

/**
 * Album and Cat Dex state, offline-first (README section 10).
 *
 * Reads come from SQLite immediately so the grid renders without a spinner, then the
 * server refresh reconciles. That ordering is what makes the album usable underground on
 * the way home from a walk.
 */

export interface AlbumFilters {
  tier?: Rarity;
  search?: string;
  sort?: 'recent' | 'score';
}

type Phase = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';

interface AlbumState {
  photos: Photo[];
  cats: Cat[];
  filters: AlbumFilters;
  phase: Phase;
  catdexPhase: Phase;
  error: string | null;
  /** True when showing cached data because the network is unreachable. */
  stale: boolean;
  nextCursor: string | null;
  loadingMore: boolean;

  load: (options?: { force?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  loadCatDex: () => Promise<void>;
  setFilters: (filters: AlbumFilters) => void;
  clearFilters: () => void;
  upsert: (photo: Photo) => Promise<void>;
  upsertCat: (cat: Cat) => void;
  /** Records which cat a photo is of. Also how a wrong answer is corrected. */
  identify: (photoId: string, choice: IdentifyChoice) => Promise<Identification>;
  setCaption: (photoId: string, caption: string) => Promise<void>;
  setShared: (photoId: string, shared: boolean) => Promise<void>;
  setShowcased: (photoId: string, showcased: boolean) => Promise<void>;
  setSharedToMap: (photoId: string, sharedToMap: boolean) => Promise<void>;
  remove: (photoId: string) => Promise<void>;
  renameCat: (catId: string, nickname: string, bio?: string) => Promise<void>;
  pinDexPhoto: (catId: string, photoId: string) => Promise<void>;
  unpinDexPhoto: (catId: string) => Promise<void>;
  byId: (photoId: string) => Photo | undefined;
  catById: (catId: string) => Cat | undefined;
  reset: () => void;
}

export const useAlbumStore = create<AlbumState>((set, get) => ({
  photos: [],
  cats: [],
  filters: {},
  phase: 'idle',
  catdexPhase: 'idle',
  error: null,
  stale: false,
  nextCursor: null,
  loadingMore: false,

  load: async (options) => {
    /*
     * The session's id, not the profile's.
     *
     * `applySession` leaves `user` null when the profile fetch fails on anything but a
     * missing row — the session is real, so the player stays signed in. Reading the profile
     * here meant one failed read at launch made this return before doing anything, with no
     * error and no log: an album stuck empty on `idle` for the whole session, and nothing on
     * screen or in the console saying a request had never been made. The album is the
     * player's own photographs, and the server already knows who they are from the token.
     *
     * It is the same id either way — `fetchMe` is given `session.user.id` — so the SQLite
     * cache keyed on it does not change hands.
     */
    const ownerId = useAuthStore.getState().session?.user?.id;
    if (!ownerId) return;

    const hadData = get().photos.length > 0;
    set({ phase: hadData ? 'refreshing' : 'loading', error: null });

    // Local first. The grid paints from cache while the request is in flight.
    if (!hadData || options?.force) {
      try {
        const local = await readPhotos({ ownerId, ...get().filters });
        if (local.length > 0) set({ photos: local, phase: 'refreshing' });
      } catch {
        // A cache read failure is not worth surfacing — the server fetch below is next.
      }
    }

    try {
      const { photos, nextCursor } = await albumApi.list({
        ...get().filters,
        limit: ALBUM_CONFIG.pageSize,
      });

      set({ photos, nextCursor, phase: 'ready', stale: false, error: null });

      // Only replace the cache on an unfiltered fetch. Replacing it from a filtered
      // response would delete every photo that did not match the filter.
      const unfiltered = Object.keys(get().filters).length === 0;
      if (unfiltered) await replacePhotos(ownerId, photos);
    } catch (err) {
      const hasData = get().photos.length > 0;

      /*
       * Any failure makes what is on screen stale, not just a dropped connection.
       *
       * `stale` used to be set only for `status === 0`, so a 401 or a 500 painted the local
       * cache as though it were fresh — same rows, no badge, no error. The failure mode that
       * produces is genuinely baffling to look at: the cache can hold photographs whose
       * objects are no longer in the bucket, and the grid then draws correctly sized tiles
       * with nothing inside them and says nothing is wrong. Cached data is worth showing;
       * pretending it was just fetched is not.
       */
      set({
        phase: hasData ? 'ready' : 'error',
        stale: hasData,
        error: hasData
          ? null
          : err instanceof ApiRequestError
            ? err.message
            : 'We could not load your album.',
      });

      // Logged even when it is swallowed for the player's benefit. A silently absorbed album
      // failure is how a schema or auth problem hides behind a screen that looks fine.
      console.warn('[album] refresh failed, showing cached photos:', err);
    }
  },

  loadMore: async () => {
    const { nextCursor, loadingMore, photos, filters } = get();
    if (!nextCursor || loadingMore) return;

    set({ loadingMore: true });

    try {
      const result = await albumApi.list({
        ...filters,
        cursor: nextCursor,
        limit: ALBUM_CONFIG.pageSize,
      });

      // Deduplicate: a photo captured mid-scroll shifts the cursor window and can repeat.
      const seen = new Set(photos.map((p) => p.id));
      const fresh = result.photos.filter((p) => !seen.has(p.id));

      set({
        photos: [...photos, ...fresh],
        nextCursor: result.nextCursor,
        loadingMore: false,
      });
    } catch {
      set({ loadingMore: false });
    }
  },

  loadCatDex: async () => {
    const hadData = get().cats.length > 0;
    set({ catdexPhase: hadData ? 'refreshing' : 'loading' });

    try {
      const { cats } = await catdexApi.list();
      set({ cats, catdexPhase: 'ready' });
    } catch {
      set({ catdexPhase: get().cats.length > 0 ? 'ready' : 'error' });
    }
  },

  setFilters: (filters) => {
    set({ filters, nextCursor: null });
    void get().load({ force: true });
  },

  clearFilters: () => {
    set({ filters: {}, nextCursor: null });
    void get().load({ force: true });
  },

  upsert: async (photo) => {
    const existing = get().photos;
    const index = existing.findIndex((p) => p.id === photo.id);

    set({
      photos:
        index === -1
          ? [photo, ...existing]
          : existing.map((p) => (p.id === photo.id ? photo : p)),
    });

    await writePhoto(photo);
  },

  upsertCat: (cat) => {
    const existing = get().cats;
    const index = existing.findIndex((c) => c.id === cat.id);

    set({
      cats:
        index === -1 ? [cat, ...existing] : existing.map((c) => (c.id === cat.id ? cat : c)),
    });
  },

  /**
   * The player's answer to "which cat is this?".
   *
   * Not optimistic, and not because of latency. The response is the only thing that knows
   * what the write actually did — whether a cat was created, what its id is, what the entry's
   * encounter count and best photo now are — and every one of those would be a guess here.
   *
   * Both objects come back because both changed, which is what lets the album and the Dex
   * update from one response instead of refetching two lists to find out.
   */
  identify: async (photoId, choice) => {
    const result = await photoApi.identify(photoId, choice);

    await get().upsert(result.photo);
    get().upsertCat(result.cat);

    /*
     * A correction is a leave and a join, and only the join comes back.
     *
     * `releasedCatId` names the entry the photograph moved *off*, which lost an encounter and
     * re-promoted its next-best photo — or vanished entirely, if this was the only shot the
     * player had of it. None of that is in the response, and guessing at it is exactly the
     * case the model's own note says to refetch rather than patch.
     */
    if (result.releasedCatId) void get().loadCatDex();

    return result;
  },

  setCaption: async (photoId, caption) => {
    const previous = get().photos;

    // Optimistic: editing a caption should feel instant. Rolled back if the server
    // disagrees, which for a caption realistically only happens offline.
    set({ photos: previous.map((p) => (p.id === photoId ? { ...p, caption } : p)) });

    try {
      const { photo } = await photoApi.update(photoId, { caption });
      await get().upsert(photo);
    } catch (err) {
      set({ photos: previous });
      throw err;
    }
  },

  setShared: async (photoId, sharedToFeed) => {
    const previous = get().photos;
    set({ photos: previous.map((p) => (p.id === photoId ? { ...p, sharedToFeed } : p)) });

    try {
      const { photo } = await photoApi.update(photoId, { sharedToFeed });
      await get().upsert(photo);
    } catch (err) {
      // Sharing is a privacy action — a failed toggle must snap back rather than leave
      // the player believing a photo is public when it is not, or vice versa.
      set({ photos: previous });
      throw err;
    }
  },

  setShowcased: async (photoId, showcased) => {
    // Not optimistic: the server enforces the showcase limit and may refuse, and showing
    // a photo as pinned that then un-pins is worse than a brief wait.
    const { photo } = await photoApi.update(photoId, { showcased });
    await get().upsert(photo);
  },

  setSharedToMap: async (photoId, sharedToMap) => {
    const previous = get().photos;
    set({ photos: previous.map((p) => (p.id === photoId ? { ...p, sharedToMap } : p)) });

    try {
      const { photo } = await photoApi.update(photoId, { sharedToMap });
      await get().upsert(photo);
    } catch (err) {
      // Same rollback as `setShared`, and for the sharper version of the same reason: a
      // switch that stayed off after failing to turn off would tell a player their location
      // is private while a pin is still on the map.
      set({ photos: previous });
      throw err;
    }
  },

  remove: async (photoId) => {
    const previousPhotos = get().photos;
    /*
     * The count lives in the auth store, not here, and it has to move with the grid.
     *
     * The album meter and the Pro upsell both read `user.photoCount` — not `photos.length` —
     * because the count is a server total and this list is one loaded page of it. So removing
     * the tile without releasing the slot left the two disagreeing: an empty grid captioned
     * "1 of 200". Captured photos increment it in `applyCaptureRewards`; this is the other
     * half, and it is rolled back below on exactly the same condition the list is.
     */
    const previousUser = useAuthStore.getState().user;

    /*
     * The XP this photograph earned, which the server is about to take back.
     *
     * `xpForScore` on the server is `Math.round(scoreTotal)`, so the score *is* the XP and
     * this needs no formula of its own. Unscored photos credited nothing and revoke nothing —
     * `scoredAt` is the field that says which, exactly as it does everywhere else.
     */
    const doomed = previousPhotos.find((p) => p.id === photoId);
    const xpRevoked = doomed?.scoredAt ? doomed.scores.total : 0;

    set({ photos: previousPhotos.filter((p) => p.id !== photoId) });
    useAuthStore.getState().releaseDeletedPhoto({ xpRevoked });

    try {
      await photoApi.remove(photoId);
      await deleteLocalPhoto(photoId);
      // Deleting a photo can empty or re-point a Dex entry server-side, so the Dex is
      // refetched rather than patched — guessing the new best shot here would be wrong
      // exactly when it matters.
      void get().loadCatDex();
      /*
       * The optimistic arithmetic above is a guess at what the server did; this is what it
       * actually did. It also repairs the case the guess cannot cover — rank, and a photo
       * deleted on another device — without making the player wait to see the tile go.
       */
      void useAuthStore.getState().refreshUser();
    } catch (err) {
      set({ photos: previousPhotos });

      // Restored wholesale rather than added back field by field, so a refreshUser that
      // landed mid-request is not undone by re-incrementing stale numbers.
      if (previousUser) useAuthStore.setState({ user: previousUser });

      throw err;
    }
  },

  renameCat: async (catId, nickname, bio) => {
    const previous = get().cats;

    set({
      cats: previous.map((c) => (c.id === catId ? { ...c, nickname, bio: bio ?? c.bio } : c)),
    });

    try {
      const { cat } = await catdexApi.update(catId, { nickname, bio });
      get().upsertCat(cat);

      // The nickname is denormalised onto every photo of this cat, so they update too.
      set({
        photos: get().photos.map((p) =>
          p.catId === catId ? { ...p, catNickname: cat.nickname ?? p.catNickname } : p
        ),
      });
    } catch (err) {
      set({ cats: previous });
      throw err;
    }
  },

  /**
   * Makes one photo the cat's Dex tile.
   *
   * Not optimistic: the entry the server returns carries the recomputed tier and score
   * for the pinned shot, and guessing those locally would repaint the tile's bezel in a
   * colour that the next refresh corrects.
   */
  pinDexPhoto: async (catId, photoId) => {
    const { cat } = await catdexApi.update(catId, { bestPhotoId: photoId });
    get().upsertCat(cat);
  },

  /** Releases the pin. Which photo takes the tile is the server's call, not a guess here. */
  unpinDexPhoto: async (catId) => {
    const { cat } = await catdexApi.update(catId, { bestPhotoPinned: false });
    get().upsertCat(cat);
  },

  byId: (photoId) => get().photos.find((p) => p.id === photoId),
  catById: (catId) => get().cats.find((c) => c.id === catId),

  reset: () =>
    set({
      photos: [],
      cats: [],
      filters: {},
      phase: 'idle',
      catdexPhase: 'idle',
      error: null,
      stale: false,
      nextCursor: null,
      loadingMore: false,
    }),
}));
