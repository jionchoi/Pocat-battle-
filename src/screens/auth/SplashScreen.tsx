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
  paper,
  marmalade,
  radii,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../../theme';

/**
 * Splash. Shown while the session is restored; RootNavigator swaps it out on `status`.
 *
 * Purely presentational — it neither hydrates nor navigates. App owns the hydrate call so
 * it runs whether or not this screen is mounted, and the navigator owns the swap, which
 * avoids the classic race where both the splash and the navigator try to route at once.
 */
export function SplashScreen() {
  const reduceMotion = useReduceMotion();

  const mark = useSharedValue(0);
  const wordmark = useSharedValue(0);

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
        <PawPrint size={40} color={marmalade[600]} weight="fill" />
      </Animated.View>

      <Animated.View style={wordStyle}>
        <Text style={[text.display, styles.title]}>Cat Frame</Text>
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
    backgroundColor: paper.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  mark: {
    width: 84,
    height: 84,
    borderRadius: radii.xxl,
    backgroundColor: marmalade[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: paper.text,
    textAlign: 'center',
  },
  tagline: {
    color: paper.textMuted,
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
});
