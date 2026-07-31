import { useCallback, useEffect, useState } from 'react';
import { useCameraPermissions } from 'expo-camera';

export type CameraPermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * Camera permission, normalised to the same three-state shape as location.
 *
 * `canAskAgain === false` is the important distinction: on iOS that means the prompt is
 * gone for good and the only path forward is the system Settings app, so the UI has to say
 * that rather than offering a button that does nothing.
 */
export function useCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<CameraPermissionState>('undetermined');

  useEffect(() => {
    if (!permission) return;

    if (permission.granted) setState('granted');
    else if (!permission.canAskAgain) setState('denied');
    else setState('undetermined');
  }, [permission]);

  const request = useCallback(async (): Promise<CameraPermissionState> => {
    const result = await requestPermission();

    const next: CameraPermissionState = result.granted
      ? 'granted'
      : result.canAskAgain
        ? 'undetermined'
        : 'denied';

    setState(next);
    return next;
  }, [requestPermission]);

  return {
    state,
    granted: state === 'granted',
    /** True when only the system Settings app can change this. */
    blocked: state === 'denied',
    request,
  };
}
