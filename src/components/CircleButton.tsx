import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { IconProps } from 'phosphor-react-native';

import {
  chrome,
  contextColors,
  glass,
  hitSlopFor,
  press,
  radii,
  useReduceMotion,
  type ContextName,
} from '../theme';

/**
 * A round icon button that floats on top of a photograph or a live camera preview.
 *
 * Two variants, and the difference is what is behind them:
 *
 *  - `glass` blurs whatever it is sitting on. Correct over a photo or the camera, where
 *    an opaque disc would punch a hole in the image, and where a flat translucent white
 *    would take on the colour of whatever happens to be underneath it.
 *  - `solid` is a plain filled disc, for a button on the app's own chrome where there is
 *    nothing interesting behind it and a blur is pure GPU cost for no visual gain.
 *
 * `BlurView` is safe here because these are always absolutely positioned — a blur inside
 * a scrolling container repaints every frame and is the fastest way to drop frames on
 * mid-range Android.
 */
export const CircleButton = React.memo(function CircleButton({
  Glyph,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  size = 40,
  glyphSize,
  variant = 'glass',
  context = 'arena',
  disabled = false,
  style,
}: {
  Glyph: React.ComponentType<IconProps>;
  onPress: () => void;
  accessibilityLabel: string;
  /** What happens on press, when the label alone does not say it. */
  accessibilityHint?: string;
  size?: number;
  glyphSize?: number;
  variant?: 'glass' | 'solid';
  /** Which side of the light/dark split the button's glyph and tint come from. */
  context?: ContextName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

  const dark = context === 'arena';
  const glyphColor = dark ? chrome.text : c.text;

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - press.scale) * pressed.value }],
  }));

  const dims = {
    width: size,
    height: size,
    borderRadius: radii.full,
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, press.config);
      }}
      hitSlop={hitSlopFor(size)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={style}
    >
      <Animated.View style={[styles.wrap, dims, { opacity: disabled ? 0.5 : 1 }, animated]}>
        {variant === 'glass' ? (
          <BlurView
            intensity={glass.intensity}
            tint={dark ? glass.tintDark : glass.tintLight}
            style={[StyleSheet.absoluteFill, dims]}
          />
        ) : null}

        {/*
          A tint over the blur, always. Blur alone samples whatever is behind it, so a
          button over a bright sky and the same button over a dark alley end up as two
          different-looking controls — the tint is what makes them one material.
        */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            dims,
            { backgroundColor: dark ? 'rgba(255,255,255,0.16)' : c.sunken },
          ]}
        />

        <Glyph size={glyphSize ?? Math.round(size * 0.45)} weight="bold" color={glyphColor} />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
