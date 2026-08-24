import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  paper,
  elevation,
  marmalade,
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

/**
 * Cat sighting. Verified pins are filled; unverified are outlined.
 *
 * One pin can stand for several photographs taken in the same spot — a doorway a cat sits in
 * every afternoon is a dozen captures within a few metres, and a dozen overlapping pins is
 * unreadable and, worse, untappable. `count` above one puts a badge on the corner, and the pin
 * itself does not change size: a bigger circle for a busier place would compete with the
 * verified/unverified distinction the fill is already carrying.
 */
export const SightingPin = React.memo(function SightingPin({
  verified,
  isMine,
  count = 1,
  onPress,
}: {
  verified: boolean;
  isMine: boolean;
  /** How many photographs are behind this pin. */
  count?: number;
  onPress: () => void;
}) {
  const { style, onPressIn, onPressOut } = usePressScale();

  const many = count > 1;

  const subject = isMine ? 'Your catch' : verified ? 'Verified cat sighting' : 'Unverified cat sighting';

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={hitSlopFor(PIN_SIZE)}
      accessibilityRole="button"
      // The count belongs in the label rather than only in the badge — the badge is a number on
      // a 30px circle, which is exactly the thing a screen reader is standing in for.
      accessibilityLabel={many ? `${subject}, ${count} photos` : subject}
      style={styles.touch}
    >
      <Animated.View style={style}>
        <View
          style={[
            styles.pin,
            {
              backgroundColor: verified ? marmalade[600] : paper.surface,
              borderColor: verified ? marmalade[700] : marmalade[600],
            },
            elevation('raised', 'paper'),
          ]}
        >
          <PawPrint
            size={16}
            color={verified ? '#FFFFFF' : marmalade[600]}
            weight={isMine ? icon.weightActive : icon.weightDefault}
          />
        </View>

        {many ? (
          <View style={styles.count} pointerEvents="none">
            {/*
              Capped at 9+. The badge is 16px across and a three-digit number in it is a smear;
              past a handful the exact figure has stopped being the point, which is that there
              are several.
            */}
            <Text style={styles.countText} allowFontScaling={false}>
              {count > 9 ? '9+' : count}
            </Text>
          </View>
        ) : null}
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
  count: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: paper.surface,
    backgroundColor: paper.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: paper.surface,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
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
    backgroundColor: marmalade[500],
  },
  selfCore: {
    width: 13,
    height: 13,
    borderRadius: radii.full,
    backgroundColor: marmalade[600],
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
});
