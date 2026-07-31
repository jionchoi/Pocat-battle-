import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { PawPrint } from 'phosphor-react-native';

import {
  bone,
  fern,
  radii,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../../theme';
import { useAuthStore } from '../../store/authStore';

/**
 * Splash. Restores the session, then the root navigator swaps stacks on `status`.
 *
 * This screen does not navigate. It reports readiness and lets RootNavigator decide, which
 * avoids the classic double-navigation race where both the splash and the navigator try to
 * route at once.
 */
export function SplashScreen() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const reduceMotion = useReduceMotion();

  const mark = useSharedValue(0);
  const wordmark = useSharedValue(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (reduceMotion) {
      mark.value = 1;
      wordmark.value = 1;
      return;
    }

    mark.value = withSequence(
      withTiming(1, { duration: 420, easing: Easing.bezier(0.32, 0.72, 0, 1) }),
      withSpring(1, spring.overshoot)
    );
    wordmark.value = withTiming(1, {
      duration: 520,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
    });
  }, [mark, reduceMotion, wordmark]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: mark.value,
    transform: [{ scale: 0.86 + mark.value * 0.14 }],
  }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordmark.value,
    transform: [{ translateY: (1 - wordmark.value) * 10 }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.mark, markStyle]}>
        <PawPrint size={40} color={fern[600]} weight="fill" />
      </Animated.View>

      <Animated.View style={wordStyle}>
        <Text style={[text.display, styles.title]}>CatSnap</Text>
        <Text style={[text.bodySm, styles.tagline]}>
          Find the cats on your own street
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: bone.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  mark: {
    width: 84,
    height: 84,
    borderRadius: radii.xxl,
    backgroundColor: fern[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: bone.text,
    textAlign: 'center',
  },
  tagline: {
    color: bone.textMuted,
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
});
