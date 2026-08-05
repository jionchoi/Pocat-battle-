import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';

import { contextColors, type ContextName } from '../theme';

/**
 * Film grain.
 *
 * Used on the arena only (see `Screen`). A flat dark field banding behind a 100pt numeral
 * is the sterile part of every dark theme; this lays a fixed tooth over it so the gradient
 * has a physical grade rather than visible steps. It does nothing useful on the white
 * context, where dots read as dirt rather than as texture.
 *
 * Implementation notes that matter:
 *
 *  - One `Svg` with a tiled `Pattern`, not hundreds of `View` dots. The whole overlay is a
 *    single node the GPU rasterises once; a View-per-dot grain is how you drop 20fps on a
 *    mid-range Android for a texture nobody can consciously see.
 *  - Absolutely positioned and `pointerEvents="none"`, mounted as a sibling *behind* the
 *    content and never inside a `ScrollView`. Grain attached to scrolling content repaints
 *    every frame of every scroll.
 *  - Three dot sizes at irregular offsets. An even grid at one radius moirés against the
 *    pixel grid and reads as a screen-door artifact instead of grain.
 */

/** Tile edge in px. Small enough to read as grain, large enough to keep the node count low. */
const TILE = 24;

export const Grain = React.memo(function Grain({
  context = 'paper',
  opacity = 1,
}: {
  context?: ContextName;
  /** Dialled down over photography, where the image supplies its own texture. */
  opacity?: number;
}) {
  const tint = contextColors(context).grain;
  // `Defs` ids are not reliably scoped to their `Svg` root on native, so two screens
  // mounted at once (a stack keeps the one underneath alive) would share whichever
  // pattern registered last — and a dark screen would quietly inherit the light tint.
  // Keying the id by context makes the collision harmless: the two that can collide are
  // identical.
  const patternId = `grain-${context}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" needsOffscreenAlphaCompositing>
      <Svg width="100%" height="100%" opacity={opacity}>
        <Defs>
          <Pattern
            id={patternId}
            x={0}
            y={0}
            width={TILE}
            height={TILE}
            patternUnits="userSpaceOnUse"
          >
            <Circle cx={3} cy={5} r={0.9} fill={tint} />
            <Circle cx={14} cy={2} r={0.6} fill={tint} />
            <Circle cx={20} cy={11} r={1.0} fill={tint} />
            <Circle cx={8} cy={15} r={0.7} fill={tint} />
            <Circle cx={17} cy={20} r={0.8} fill={tint} />
            <Circle cx={2} cy={22} r={0.6} fill={tint} />
            <Circle cx={11} cy={9} r={0.5} fill={tint} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${patternId})`} />
      </Svg>
    </View>
  );
});
