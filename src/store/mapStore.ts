import { create } from 'zustand';

import { ApiRequestError } from '../api/client';
import { bboxParam, mapApi, type MapSighting } from '../api/endpoints';
import { MAP_CONFIG } from '../constants/game';

/**
 * Map viewport state (README sections 9.6 and 10).
 *
 * Data is fetched by bounding box as the user pans, never as a whole city. The debounce
 * and the in-flight abort together are what stop a pan gesture from firing thirty
 * overlapping requests.
 */

export interface Viewport {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type MapLayer = 'mine' | 'community';

interface MapState {
  sightings: MapSighting[];
  layer: MapLayer;
  loading: boolean;
  error: string | null;
  offline: boolean;
  lastViewport: Viewport | null;

  setLayer: (layer: MapLayer) => void;
  fetchViewport: (viewport: Viewport) => void;
  retry: () => void;
  visibleSightings: () => MapSighting[];
  reset: () => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: AbortController | null = null;

export const useMapStore = create<MapState>((set, get) => ({
  sightings: [],
  layer: 'community',
  loading: false,
  error: null,
  offline: false,
  lastViewport: null,

  setLayer: (layer) => set({ layer }),

  /**
   * Debounced so panning does not spam the API, and the previous request is aborted so a
   * slow response for an old viewport cannot overwrite a newer one.
   */
  fetchViewport: (viewport) => {
    set({ lastViewport: viewport });

    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;

      set({ loading: true, error: null });

      try {
        const bbox = bboxParam(viewport);
        const { sightings } = await mapApi.sightings(bbox, controller.signal);

        if (controller.signal.aborted) return;

        set({
          sightings,
          loading: false,
          offline: false,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted) return;

        const offline = err instanceof ApiRequestError && err.status === 0;
        const hasData = get().sightings.length > 0;

        set({
          loading: false,
          offline,
          // Keep whatever is already on the map. A blank map is worse than a slightly
          // stale one, so the error copy says the view is old rather than clearing it.
          error: hasData
            ? offline
              ? 'You appear to be offline. Showing your last view.'
              : null
            : err instanceof ApiRequestError
              ? err.message
              : 'We could not load the map.',
        });
      } finally {
        if (inFlight === controller) inFlight = null;
      }
    }, MAP_CONFIG.viewportDebounceMs);
  },

  retry: () => {
    const viewport = get().lastViewport;
    if (viewport) get().fetchViewport(viewport);
  },

  visibleSightings: () => {
    const { sightings, layer } = get();
    return layer === 'mine' ? sightings.filter((s) => s.isMine) : sightings;
  },

  reset: () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    inFlight?.abort();
    inFlight = null;
    set({
      sightings: [],
      loading: false,
      error: null,
      offline: false,
      lastViewport: null,
    });
  },
}));
