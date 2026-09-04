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
  /**
   * The album, unfiltered. The canonical list, and the only one anything outside the grid
   * should read.
   *
   * Filtering used to write straight into this, which is a data-layer decision that leaked
   * into two screens that never asked a question: the profile's "Recent" strip and its photo
   * count both read this array, so filtering the album to Legendary emptied the profile as
   * well. A filter is a way of *looking* at the album, not a smaller album.
   */
  photos: Photo[];
  /**
   * The current filtered query's results, or null when no filter is set.
   *
   * A separate list rather than a predicate over `photos`, because the filter has to reach the
   * whole album and `photos` holds one page of twenty. Filtering client-side would mean
   * "Legendary" showing nothing until the player had scrolled far enough to load one.
   */
  filtered: Photo[] | null;
  /** True while a filtered query is in flight. Deliberately not `phase`. See `applyFilters`. */
  filtering: boolean;
  /** Pagination for `filtered`, kept apart from `nextCursor` so the two cannot cross. */
  filteredCursor: string | null;
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
  /** Re-runs the current filters. Called by `setFilters`; exposed for retries. */
  applyFilters: () => Promise<void>;
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

/**
 * One field-level edit, applied to the album and to the filtered view of it.
 *
 * Every optimistic edit on this store used to map over `photos` alone. That was correct while
 * there was one list; with `filtered` beside it, a caption typed on a photograph found through
 * a rarity chip was written to a list the screen was not reading, so it reverted on the next
 * render and came back only after a refetch.
 *
 * `filtered` is left as `null` when it already is: an absent filtered view must not be brought
 * into existence by an edit, because null is what tells the grid there is no filter.
 */
function patchPhoto(
  state: Pick<AlbumState, 'photos' | 'filtered'>,
  photoId: string,
  patch: Partial<Photo>
): Pick<AlbumState, 'photos' | 'filtered'> {
  const apply = (list: Photo[]) =>
    list.map((p) => (p.id === photoId ? { ...p, ...patch } : p));

  return {
    photos: apply(state.photos),
    filtered: state.filtered ? apply(state.filtered) : null,
  };
}

export const useAlbumStore = create<AlbumState>((set, get) => ({
  photos: [],
  filtered: null,
  filtering: false,
  filteredCursor: null,
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
        // Unfiltered, like the request below it. See the note on `photos`.
        const local = await readPhotos({ ownerId });
        if (local.length > 0) set({ photos: local, phase: 'refreshing' });
      } catch {
        // A cache read failure is not worth surfacing — the server fetch below is next.
      }
    }

    try {
      /*
       * No filters on this request, ever.
       *
       * This is the album itself, not a view of it — `applyFilters` is what asks a narrower
       * question, and it keeps its answer in `filtered`. Sending the filters here is what
       * used to make a rarity chip replace the canonical list, which took the profile's
       * "Recent" strip and its photo count down with it.
       */
      const { photos, nextCursor } = await albumApi.list({
        limit: ALBUM_CONFIG.pageSize,
      });

      set({ photos, nextCursor, phase: 'ready', stale: false, error: null });

      // Unconditional now that this response is always the whole album. It used to be gated
      // on there being no filters, because replacing the cache from a filtered response
      // deletes every photo that did not match.
      await replacePhotos(ownerId, photos);
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

  /**
   * The next page of whichever list is on screen.
   *
   * Two lists, two cursors, and the active filter is what decides which pair this is talking
   * about. Sharing one cursor between them would page the filtered list with an offset into
   * the unfiltered one, which does not fail — it silently returns the wrong photographs.
   */
  loadMore: async () => {
    const { loadingMore, photos, filtered, filters, nextCursor, filteredCursor } = get();
    if (loadingMore) return;

    const isFiltered = filtered !== null;
    const cursor = isFiltered ? filteredCursor : nextCursor;
    const current = isFiltered ? filtered : photos;
    if (!cursor) return;

    set({ loadingMore: true });

    try {
      const result = await albumApi.list({
        ...(isFiltered ? filters : {}),
        cursor,
        limit: ALBUM_CONFIG.pageSize,
      });

      // Deduplicate: a photo captured mid-scroll shifts the cursor window and can repeat.
      const seen = new Set(current.map((p) => p.id));
      const fresh = result.photos.filter((p) => !seen.has(p.id));

      set(
        isFiltered
          ? {
              filtered: [...current, ...fresh],
              filteredCursor: result.nextCursor,
              loadingMore: false,
            }
          : {
              photos: [...current, ...fresh],
              nextCursor: result.nextCursor,
              loadingMore: false,
            }
      );
    } catch {
      set({ loadingMore: false });
    }
  },

  /**
   * Runs the current filters and keeps the answer beside the album rather than on top of it.
   *
   * `filtering` rather than `phase: 'refreshing'`, and that distinction is the whole point:
   * `phase` drives the grid's pull-to-refresh control, so routing a filter through it dropped
   * the platform's refresh spinner from the top of the screen every time a rarity chip was
   * tapped. A filter is not a refresh — the player did not ask for newer data, they asked a
   * narrower question — so it gets its own flag and its own quiet treatment.
   *
   * An empty filter set is not a query. It clears `filtered` and the grid falls back to the
   * album, which is why nothing here has to fetch to get back to the unfiltered view.
   */
  applyFilters: async () => {
    const { filters } = get();

    if (Object.keys(filters).length === 0) {
      set({ filtered: null, filteredCursor: null, filtering: false });
      return;
    }

    set({ filtering: true });

    try {
      const { photos, nextCursor } = await albumApi.list({
        ...filters,
        limit: ALBUM_CONFIG.pageSize,
      });

      // Checked against the filters this started with: a player tapping through chips can
      // land a slow response after a newer one, and the last write would win the wrong way.
      if (get().filters !== filters) return;

      set({ filtered: photos, filteredCursor: nextCursor, filtering: false });
    } catch {
      // No error surface of its own. The album underneath is intact and the grid falls back
      // to it, which is a better answer than an empty screen with a message on it.
      set({ filtered: null, filteredCursor: null, filtering: false });
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
    // `nextCursor` is untouched: it belongs to the unfiltered album, which this does not
    // disturb. Resetting it here is what used to make the album forget its own pagination
    // every time a chip was tapped.
    set({ filters });
    void get().applyFilters();
  },

  clearFilters: () => {
    // Synchronous and complete. Going back to the whole album is not a fetch — the album is
    // already in `photos` — so this is the one filter transition with no request behind it.
    set({ filters: {}, filtered: null, filteredCursor: null, filtering: false });
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
    /*
     * Both lists, because `patchPhoto` writes to both.
     *
     * A rollback that restored `photos` alone would leave the optimistic edit standing in
     * `filtered` — which is the list the grid is reading whenever a filter is on, so the
     * failure would be invisible on exactly the screen it happened on.
     */
    const previous = { photos: get().photos, filtered: get().filtered };

    // Optimistic: editing a caption should feel instant. Rolled back if the server
    // disagrees, which for a caption realistically only happens offline.
    set(patchPhoto(get(), photoId, { caption }));

    try {
      const { photo } = await photoApi.update(photoId, { caption });
      await get().upsert(photo);
    } catch (err) {
      set(previous);
      throw err;
    }
  },

  setShared: async (photoId, sharedToFeed) => {
    // Both lists. See `setCaption`.
    const previous = { photos: get().photos, filtered: get().filtered };
    set(patchPhoto(get(), photoId, { sharedToFeed }));

    try {
      const { photo } = await photoApi.update(photoId, { sharedToFeed });
      await get().upsert(photo);
    } catch (err) {
      // Sharing is a privacy action — a failed toggle must snap back rather than leave
      // the player believing a photo is public when it is not, or vice versa.
      set(previous);
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
    // Both lists. See `setCaption`.
    const previous = { photos: get().photos, filtered: get().filtered };
    set(patchPhoto(get(), photoId, { sharedToMap }));

    try {
      const { photo } = await photoApi.update(photoId, { sharedToMap });
      await get().upsert(photo);
    } catch (err) {
      // Same rollback as `setShared`, and for the sharper version of the same reason: a
      // switch that stayed off after failing to turn off would tell a player their location
      // is private while a pin is still on the map.
      set(previous);
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
     * No XP is computed here any more, and that is the whole of what deleting now costs: a
     * tile and a slot.
     *
     * This used to work out the score's XP so it could be subtracted optimistically. As of
     * 2026-08-31 the server revokes nothing on a delete — the reveal that paid for the score is
     * not refunded either, so taking the reward back would charge the player twice — and the
     * client has no figure to guess.
     */
    const previousFiltered = get().filtered;

    // Both lists, or a photo deleted from a filtered grid leaves its tile behind on the very
    // screen the player deleted it from.
    set({
      photos: previousPhotos.filter((p) => p.id !== photoId),
      filtered: previousFiltered?.filter((p) => p.id !== photoId) ?? null,
    });
    useAuthStore.getState().releaseDeletedPhoto();

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
      set({ photos: previousPhotos, filtered: previousFiltered });

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

  /*
   * Both lists, and the filtered one is not redundant.
   *
   * `filtered` reaches the whole album while `photos` holds the pages that have been scrolled
   * to, so a photograph two pages deep in a rarity filter is on screen and reachable by tap
   * while being absent from `photos` entirely. Looking in one list only is how tapping a card
   * in a filtered grid opens a detail screen that cannot find its own photo.
   */
  byId: (photoId) =>
    get().photos.find((p) => p.id === photoId) ??
    get().filtered?.find((p) => p.id === photoId),
  catById: (catId) => get().cats.find((c) => c.id === catId),

  reset: () =>
    set({
      photos: [],
      cats: [],
      filters: {},
      filtered: null,
      filtering: false,
      filteredCursor: null,
      phase: 'idle',
      catdexPhase: 'idle',
      error: null,
      stale: false,
      nextCursor: null,
      loadingMore: false,
    }),
}));
