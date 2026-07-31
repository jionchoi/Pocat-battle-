import * as Location from 'expo-location';

import type { GeoPoint } from '../models';

/**
 * Location access.
 *
 * Permission is always requested after the app has explained why (the onboarding carousel
 * and the pre-permission screens), never cold — a denied prompt is very hard to recover
 * from on iOS, so the explanation has to come first.
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function checkPermission(): Promise<PermissionState> {
  const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (!canAskAgain) return 'denied';
  return status === Location.PermissionStatus.DENIED && !canAskAgain
    ? 'denied'
    : 'undetermined';
}

export async function requestPermission(): Promise<PermissionState> {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  return canAskAgain ? 'undetermined' : 'denied';
}

export async function currentPosition(): Promise<GeoPoint | null> {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * A catch needs a real fix, not a cached one from an hour ago — the location is what ties
 * the cat to a place and drives the re-encounter identity key.
 */
export async function positionForCatch(): Promise<GeoPoint | null> {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    // Reject a wildly imprecise fix rather than recording a cat on the wrong street.
    if (position.coords.accuracy && position.coords.accuracy > 100) {
      const retry = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      return { lat: retry.coords.latitude, lng: retry.coords.longitude };
    }

    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

export type LocationSubscription = { remove: () => void };

/**
 * Watch position for the map's own-location dot.
 *
 * Distance-based rather than time-based updates: a stationary player should not wake the
 * GPS every second, which is the difference between a walk and a dead battery.
 */
export async function watchPosition(
  onChange: (point: GeoPoint) => void
): Promise<LocationSubscription | null> {
  try {
    return await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 12,
        timeInterval: 5000,
      },
      (position) => {
        onChange({ lat: position.coords.latitude, lng: position.coords.longitude });
      }
    );
  } catch {
    return null;
  }
}

/** Viewport bbox from a region, used for the map's bounding-box queries. */
export function regionToViewport(region: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}) {
  return {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLng: region.longitude - region.longitudeDelta / 2,
    maxLng: region.longitude + region.longitudeDelta / 2,
  };
}
