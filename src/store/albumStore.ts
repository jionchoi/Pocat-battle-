import { create } from 'zustand';

import { ApiRequestError } from '../api/client';
import { albumApi, catdexApi, photoApi } from '../api/endpoints';
import { ALBUM_CONFIG } from '../constants/game';
import type { Cat, Photo, Rarity } from '../models';
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
  setCaption: (photoId: string, caption: string) => Promise<void>;
  setShared: (photoId: string, shared: boolean) => Promise<void>;
  setShowcased: (photoId: string, showcased: boolean) => Promise<void>;
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
    const ownerId = useAuthStore.getState().user?.id;
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
      const offline = err instanceof ApiRequestError && err.status === 0;
      const hasData = get().photos.length > 0;

      set({
        phase: hasData ? 'ready' : 'error',
        stale: offline && hasData,
        error: hasData
          ? null
          : err instanceof ApiRequestError
            ? err.message
            : 'We could not load your album.',
      });
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

  remove: async (photoId) => {
    const previousPhotos = get().photos;
    set({ photos: previousPhotos.filter((p) => p.id !== photoId) });

    try {
      await photoApi.remove(photoId);
      await deleteLocalPhoto(photoId);
      // Deleting a photo can empty or re-point a Dex entry server-side, so the Dex is
      // refetched rather than patched — guessing the new best shot here would be wrong
      // exactly when it matters.
      void get().loadCatDex();
    } catch (err) {
      set({ photos: previousPhotos });
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
