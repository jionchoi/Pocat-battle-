import React from 'react';
import { StyleSheet, View } from 'react-native';

import { filterById } from '../constants/filters';

/**
 * The filter, as a single composited layer over the camera preview.
 *
 * The whole of the effect is one absolutely-positioned view with a blend mode on it. There is
 * no shader, no frame processor and no native module: `mixBlendMode` landed in React Native
 * 0.76 on both platforms, and a blend against a live preview is done by the compositor
 * rather than by anything this component has to run per frame.
 *
 * **It never touches the file.** This is drawn above `CameraView` and `takePictureAsync`
 * reads the camera, not the screen — so the graded image exists only on the glass. That is
 * the design rather than a limitation; `constants/filters.ts` says why, and the capture
 * overlay tells the player in as many words.
 *
 * `pointerEvents="none"` because it spans the viewfinder: without it this would sit between
 * the player's finger and every control on the screen.
 */
export const CaptureFilterLayer = React.memo(function CaptureFilterLayer({
  filterId,
}: {
  filterId: string;
}) {
  const { layer } = filterById(filterId);

  /*
   * Natural renders nothing at all.
   *
   * Not a transparent layer and not `opacity: 0` — no view. A blend layer that composites to
   * a no-op is still a compositing pass over every frame of a live camera, which is a real
   * cost on the one screen in the app that cannot afford dropped frames.
   */
  if (!layer) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: layer.color,
          mixBlendMode: layer.blendMode,
          opacity: layer.opacity,
        },
      ]}
    />
  );
});
