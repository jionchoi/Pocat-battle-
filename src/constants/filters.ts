import type { BlendMode } from 'react-native';

import { marmalade } from '../theme';

/**
 * Capture filters.
 *
 * ## They are a viewfinder treatment, not a photo edit
 *
 * **The filter never reaches the file.** `takePictureAsync` returns the camera's own frame,
 * that is what `uploadCapture` puts in the bucket, and that is what the model is shown. The
 * overlay this file describes is drawn on top of the preview and stops at the glass.
 *
 * That is a deliberate choice and the capture screen states it in words — see the caption
 * under the rail — because a filter that silently did nothing to the saved photograph would
 * be the app lying about what it just took. The player gets told once, plainly, and then the
 * rail is free to be fun.
 *
 * Two reasons it is drawn this way rather than baked:
 *
 * 1. **The score.** Composition is forty points of a scoring rubric that judges light and
 *    colour, and `bonus` rewards golden light specifically. Baking a warm grade into the
 *    upload would let a filter buy points, and the three filters here are rank-gated shop
 *    entries — so it would be rank buying score. Preview-only makes that unreachable rather
 *    than merely discouraged: the model is never handed the graded pixels at all.
 *
 * 2. **The dependency.** `expo-image-manipulator` resizes, crops and rotates; it does not
 *    grade. Baking needs Skia or a GL pass, which is a native module and a dev-client
 *    rebuild. Not worth it to ship a viewfinder toy.
 *
 * ## If you ever do want them baked
 *
 * Everything needed is already separated: this file is the *description* of a look, and
 * `CaptureFilterLayer` is the only thing that reads it. Add the pixel pass in
 * `CaptureScreen.submit` between `takePictureAsync` and `uploadCapture`, bump
 * `SCORING_VERSION` on the server because the model starts seeing different images, and
 * settle the rank gate first — `server/src/game/shop.ts` gates two of these three behind a
 * photographer rank, and the moment a filter changes a score that gate becomes pay-to-win.
 *
 * ## Why blend modes and not opacity
 *
 * A flat translucent colour over a camera frame washes it out — it lifts the blacks and the
 * whole preview goes milky, which reads as a bug rather than as a look. React Native 0.76
 * brought `mixBlendMode` to both platforms, so these composite the way a photo app's do:
 * `saturation` drains colour without touching luminance, `soft-light` warms the midtones and
 * leaves the highlights alone. RN 0.81 is what this project is on, so it is available.
 *
 * `isolation: 'isolate'` on the layer's parent matters — without it the blend reaches past
 * the preview and picks up whatever is behind the camera view.
 */

export interface CaptureFilter {
  /** Matches the shop's product id, so the rail and the catalogue cannot drift apart. */
  id: string;
  /** What the rail prints. Short — this sits under a shutter on a live preview. */
  label: string;
  /**
   * The overlay, or null for the untouched frame.
   *
   * `null` is not "a filter that does nothing" — it renders no layer at all, so the preview
   * has nothing composited over it whatsoever.
   */
  layer: {
    color: string;
    blendMode: BlendMode;
    /** Applied to the layer, after the blend. Keeps each look tunable in one number. */
    opacity: number;
  } | null;
}

/**
 * The three the shop sells, in the order the rail scrolls them.
 *
 * Natural is first and is the default, so the rail opens on the unfiltered frame and every
 * other option is a deliberate scroll away from it. A camera that opens already graded would
 * be making the choice for the player.
 */
export const CAPTURE_FILTERS: readonly CaptureFilter[] = [
  {
    id: 'filter-natural',
    label: 'Natural',
    layer: null,
  },
  {
    id: 'filter-golden-hour',
    label: 'Golden Hour',
    /*
     * Warm midtones, untouched highlights.
     *
     * `soft-light` is what makes this read as light rather than as a sheet of orange — it
     * pushes the midtones warm and leaves the brightest parts of the frame where they are,
     * so a white wall stays white and a cat's fur picks up the warmth.
     */
    layer: {
      color: marmalade[500],
      blendMode: 'soft-light',
      opacity: 0.85,
    },
  },
  {
    id: 'filter-monochrome',
    label: 'Monochrome',
    /*
     * A true desaturation, not a grey wash.
     *
     * The `saturation` blend takes the *saturation* of this layer and the hue and luminance
     * of what is underneath. A fully neutral grey has no saturation, so the result keeps
     * every tone of the frame exactly where it was and removes only the colour. Any grey
     * works; the value is irrelevant as long as R, G and B are equal.
     */
    layer: {
      color: '#808080',
      blendMode: 'saturation',
      opacity: 1,
    },
  },
];

/** The rail's opening position. See the note on ordering above. */
export const DEFAULT_FILTER_ID = CAPTURE_FILTERS[0]!.id;

export function filterById(id: string): CaptureFilter {
  return CAPTURE_FILTERS.find((f) => f.id === id) ?? CAPTURE_FILTERS[0]!;
}

/**
 * The stand-in "scene" each swatch in the rail is drawn over.
 *
 * A filter preview has to show the filter doing something, and the one thing it cannot show
 * is the actual camera feed — sampling live frames to render three thumbnails would mean
 * three extra render passes over every frame, on the screen that can least afford them.
 *
 * So the swatch grades a fixed gradient instead, using the *same* layer definition the
 * viewfinder uses. That is the point of doing it this way rather than hand-picking a colour
 * per swatch: the preview is generated by the filter, so it cannot drift from what the filter
 * actually does. Change a blend mode above and every swatch updates with it.
 *
 * These three stops are chosen to have somewhere to go under both filters — a warm highlight,
 * a mid, and a near-black. A flat mid-grey would show nothing under Golden Hour, and a
 * saturated block would show nothing under Monochrome.
 */
export const SWATCH_SCENE = ['#F7D2A6', '#9A7250', '#241F1B'] as const;
