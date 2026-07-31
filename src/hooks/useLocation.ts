import { useCallback, useEffect, useRef, useState } from 'react';

import type { GeoPoint } from '../models';
import {
  checkPermission,
  currentPosition,
  requestPermission,
  watchPosition,
  type LocationSubscription,
  type PermissionState,
} from '../services/location';

/**
 * Player location for the map and for catch submission.
 *
 * The watch subscription is always torn down on unmount — a leaked GPS watcher keeps the
 * radio awake for the rest of the session.
 */
export function useLocation(options: { watch?: boolean } = {}) {
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [position, setPosition] = useState<GeoPoint | null>(null);
  const [loading, setLoading] = useState(true);

  const subscription = useRef<LocationSubscription | null>(null);
  const mounted = useRef(true);

  const request = useCallback(async () => {
    const state = await requestPermission();
    if (!mounted.current) return state;
    setPermission(state);

    if (state === 'granted') {
      const point = await currentPosition();
      if (mounted.current && point) setPosition(point);
    }

    return state;
  }, []);

  useEffect(() => {
    mounted.current = true;

    (async () => {
      const state = await checkPermission();
      if (!mounted.current) return;

      setPermission(state);

      if (state === 'granted') {
        const point = await currentPosition();
        if (mounted.current && point) setPosition(point);

        if (options.watch) {
          const sub = await watchPosition((next) => {
            if (mounted.current) setPosition(next);
          });
          if (mounted.current) subscription.current = sub;
          // Unmounted while awaiting the subscription — tear it down immediately.
          else sub?.remove();
        }
      }

      if (mounted.current) setLoading(false);
    })();

    return () => {
      mounted.current = false;
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [options.watch]);

  return { permission, position, loading, request };
}
