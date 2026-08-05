import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  Circle,
  Crown,
  Diamond,
  Hexagon,
  type IconProps,
} from 'phosphor-react-native';

import {
  chrome,
  rarity as rarityTokens,
  type Rarity,
} from '../theme';

/**
 * The tier crest — the hexagonal seal on the score reveal.
 *
 * This is the one moment in the product where the tier is the subject rather than a label
 * on something else, so it gets a shape of its own instead of the corner badge blown up.
 * A hexagon reads as a seal or a medal; a scaled-up pill reads as a tooltip.
 *
 * Drawn as an SVG path rather than a `clipPath` on a View, because `clip-path` polygons
 * are a web-only CSS feature — the RN equivalent silently does nothing, which would leave
 * a plain coloured square sitting in the middle of the most important screen in the app.
 *
 * The glow is a shadow at the tier's own hue on a wrapper view. Every tier gets one here,
 * not just Legendary: at this size the crest is a light source, and an unlit one on a
 * dimmed photograph looks like a sticker.
 */

const GLYPHS: Record<Rarity, React.ComponentType<IconProps>> = {
  Common: Circle,
  Rare: Diamond,
  Epic: Hexagon,
  Legendary: Crown,
};

const SIZE = 96;

/**
 * A flat-top hexagon at the design's proportions: the points sit at 5% and 95% of the
 * width and 25%/75% of the height, which is slightly wider than a regular hexagon and
 * stops it reading as a honeycomb cell.
 */
function hexPath(size: number): string {
  const p = (x: number, y: number) => `${(x * size).toFixed(2)},${(y * size).toFixed(2)}`;
  return [
    `M${p(0.5, 0)}`,
    `L${p(0.95, 0.25)}`,
    `L${p(0.95, 0.75)}`,
    `L${p(0.5, 1)}`,
    `L${p(0.05, 0.75)}`,
    `L${p(0.05, 0.25)}`,
    'Z',
  ].join(' ');
}

export const TierCrest = React.memo(function TierCrest({
  tier,
  size = SIZE,
  style,
}: {
  tier: Rarity;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const spec = rarityTokens[tier];
  const Glyph = GLYPHS[tier];

  return (
    <View
      accessibilityLabel={`${tier} tier`}
      style={[styles.wrap, { width: size, height: size }, style]}
    >
      {/*
        The halo. A radial gradient would be truer to the design, but RN has no radial
        background and an SVG one would need its own layer over the photo — a blurred
        shadow at the same hue lands in the same place for a fraction of the cost.
      */}
      <View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: spec.base,
            shadowColor: spec.base,
            shadowRadius: size * 0.34,
          },
        ]}
      />

      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`crest-${tier}`} x1="0" y1="0" x2="0.6" y2="1">
            {/* Lit from the top-left, matching every other shadow in the product. */}
            <Stop offset="0" stopColor={spec.base} stopOpacity="1" />
            <Stop offset="1" stopColor={spec.label} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Path d={hexPath(size)} fill={`url(#crest-${tier})`} />
      </Svg>

      <Glyph size={Math.round(size * 0.31)} weight="fill" color={chrome.text} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    // The view itself is invisible; only its shadow is wanted. Opacity zero would take
    // the shadow with it on Android, so the fill is transparent instead.
    opacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    elevation: 12,
  },
});
