import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Sparkle } from 'phosphor-react-native';

import type { Cat } from '../models';
import {
  bezelPad,
  concentric,
  contextColors,
  fern,
  icon,
  innerHighlight,
  press,
  radii,
  rarity as rarityTokens,
  spacing,
  staggerDelay,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';

/**
 * CatDexEntry — one recurring real cat (README section 6).
 *
 * Shows the player's best shot of the cat, their name for it, and how many times they
 * have photographed it. The encounter count is the relationship: it is what turns "a
 * tabby I saw once" into "the tabby on my street", which is the whole point of the Dex
 * replacing a raise-a-pet system.
 */

export const CatDexEntry = React.memo(function CatDexEntry({
  cat,
  onPress,
  index = 0,
  context = 'bone',
  style,
}: {
  cat: Cat;
  onPress: () => void;
  index?: number;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const spec = rarityTokens[cat.bestTier];
  const reduceMotion = useReduceMotion();

  const pressed = useSharedValue(0);
  const enter = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      enter.value = 1;
      return;
    }

    enter.value = withDelay(
      staggerDelay(index),
      withTiming(1, { duration: 620, easing: Easing.bezier(0.32, 0.72, 0, 1) })
    );
  }, [enter, index, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 12 },
      { scale: 1 - (1 - press.scale) * pressed.value },
    ],
  }));

  const encounterLabel =
    cat.encounterCount === 1 ? 'Seen once' : `Seen ${cat.encounterCount} times`;

  return (
    <Animated.View style={[animated, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, press.config);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${cat.nickname ?? 'Unnamed cat'}, ${encounterLabel}${
          cat.discoveredByMe ? ', discovered by you' : ''
        }`}
        style={[
          styles.shell,
          { backgroundColor: spec.shellTint, borderColor: spec.ring },
        ]}
      >
        <View
          style={[
            styles.core,
            { backgroundColor: c.surface },
            innerHighlight(c.innerHighlight),
          ]}
        >
          <View style={styles.photo}>
            <Image
              source={cat.bestPhotoUrl || undefined}
              contentFit="cover"
              transition={200}
              style={StyleSheet.absoluteFill}
              accessible={false}
            />
            {!cat.bestPhotoUrl ? (
              <View style={[styles.noPhoto, { backgroundColor: c.sunken }]}>
                <Text style={[text.caption, { color: c.textFaint }]}>No image</Text>
              </View>
            ) : null}

            {/* The discoverer mark. First-to-find is the only status in this app that
                cannot be bought or out-ground, so it gets a permanent badge. */}
            {cat.discoveredByMe ? (
              <View style={styles.discovered}>
                <Sparkle size={11} color={fern[700]} weight={icon.weightActive} />
              </View>
            ) : null}
          </View>

          <View style={styles.meta}>
            <Text style={[text.bodySm, { color: c.text }]} numberOfLines={1}>
              {cat.nickname ?? 'Unnamed cat'}
            </Text>
            <Text style={[text.caption, { color: c.textMuted }]} numberOfLines={1}>
              {encounterLabel}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const OUTER_RADIUS = radii.lg + 4;

const styles = StyleSheet.create({
  shell: {
    borderWidth: 1,
    borderRadius: OUTER_RADIUS,
    padding: bezelPad,
  },
  core: {
    borderRadius: concentric(OUTER_RADIUS, bezelPad),
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
  },
  noPhoto: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discovered: {
    position: 'absolute',
    top: spacing.xxs,
    right: spacing.xxs,
    width: 20,
    height: 20,
    borderRadius: radii.full,
    backgroundColor: fern[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    gap: 1,
  },
});
