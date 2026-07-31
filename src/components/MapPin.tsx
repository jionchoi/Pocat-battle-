import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { PawPrint } from 'phosphor-react-native';

import {
  bone,
  elevation,
  fern,
  hitSlopFor,
  icon,
  layout,
  radii,
  perpetual,
  press,
  useReduceMotion,
} from '../theme';

/**
 * Map pins.
 *
 * Every pin is wrapped so its touch target reaches 44x44 even though the visible glyph is
 * 26px — a pin you cannot reliably tap is worse than no pin.
 */

const PIN_SIZE = 30;

function usePressScale() {
  const pressed = useSharedValue(0);
  const reduceMotion = useReduceMotion();

  const style = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - (1 - press.scale) * pressed.value },
      { translateY: press.translateY * pressed.value },
    ],
  }));

  return {
    style,
    onPressIn: () => {
      pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
    },
    onPressOut: () => {
      pressed.value = withSpring(0, press.config);
    },
  };
}

/** Cat sighting. Verified pins are filled; unverified are outlined. */
export const SightingPin = React.memo(function SightingPin({
  verified,
  isMine,
  onPress,
}: {
  verified: boolean;
  isMine: boolean;
  onPress: () => void;
}) {
  const { style, onPressIn, onPressOut } = usePressScale();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={hitSlopFor(PIN_SIZE)}
      accessibilityRole="button"
      accessibilityLabel={
        isMine
          ? 'Your catch'
          : verified
            ? 'Verified cat sighting'
            : 'Unverified cat sighting'
      }
      style={styles.touch}
    >
      <Animated.View
        style={[
          styles.pin,
          {
            backgroundColor: verified ? fern[600] : bone.surface,
            borderColor: verified ? fern[700] : fern[600],
          },
          elevation('raised', 'bone'),
          style,
        ]}
      >
        <PawPrint
          size={16}
          color={verified ? '#FFFFFF' : fern[600]}
          weight={isMine ? icon.weightActive : icon.weightDefault}
        />
      </Animated.View>
    </Pressable>
  );
});

/**
 * The player's own position. Breathes continuously so the map feels alive at rest —
 * isolated and memoized so the loop cannot re-render the map.
 */
export const SelfMarker = React.memo(function SelfMarker() {
  const scale = useSharedValue(1);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) return;

    scale.value = withRepeat(
      withTiming(perpetual.breathe.to, {
        duration: perpetual.breathe.duration,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );

    return () => {
      cancelAnimation(scale);
    };
  }, [reduceMotion, scale]);

  const halo = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * 1.9 }],
    opacity: 0.22,
  }));

  const core = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={styles.self}
      accessibilityLabel="Your location"
      pointerEvents="none"
    >
      <Animated.View style={[styles.selfHalo, halo]} />
      <Animated.View style={[styles.selfCore, core]} />
    </View>
  );
});

const styles = StyleSheet.create({
  touch: {
    width: layout.minTouch,
    height: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: radii.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  self: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfHalo: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: radii.full,
    backgroundColor: fern[500],
  },
  selfCore: {
    width: 13,
    height: 13,
    borderRadius: radii.full,
    backgroundColor: fern[600],
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
});
