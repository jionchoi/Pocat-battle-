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
import { RarityBadge } from './Badge';
import {
  chrome,
  contextColors,
  marmalade,
  photoScrim,
  press,
  radii,
  spacing,
  staggerDelay,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';

/**
 * CatDexEntry — one recurring real cat (README section 6).
 *
 * A square crop of the player's best shot, the tier worn as a disc in the corner, and
 * their name for the cat centred underneath. Three across, so the tile is roughly 110pt
 * and there is room for exactly one line of chrome on the image.
 *
 * The encounter count rides *on* the photo rather than as a second line below it. It is
 * the whole point of the Dex — it is what turns "a tabby I saw once" into "the tabby on
 * my street" — but a second text line under every tile adds 15pt to a nine-row grid and
 * pushes the name away from the face it belongs to. On the image it costs nothing.
 */

export const CatDexEntry = React.memo(function CatDexEntry({
  cat,
  onPress,
  index = 0,
  context = 'paper',
  style,
}: {
  cat: Cat;
  onPress: () => void;
  index?: number;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
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
        accessibilityLabel={`${cat.nickname ?? 'Unnamed cat'}, ${cat.bestTier}, ${encounterLabel}${
          cat.discoveredByMe ? ', discovered by you' : ''
        }`}
        style={styles.wrap}
      >
        <View style={[styles.tile, { backgroundColor: c.sunken }]}>
          <Image
            source={cat.bestPhotoUrl || undefined}
            contentFit="cover"
            transition={200}
            style={StyleSheet.absoluteFill}
            accessible={false}
          />
          {!cat.bestPhotoUrl ? (
            <View style={styles.noPhoto}>
              <Text style={[text.caption, { color: c.textFaint }]}>No image</Text>
            </View>
          ) : null}

          {/* Only under the count, so a tile with nothing written on it stays clean. */}
          {cat.encounterCount > 1 ? (
            <View pointerEvents="none" style={styles.countScrim} />
          ) : null}

          <View style={styles.corner} pointerEvents="none">
            {/* First-to-find is the only status in this app that cannot be bought or
                out-ground, so it gets a permanent mark of its own beside the tier. */}
            {cat.discoveredByMe ? (
              <View style={styles.discovered}>
                <Sparkle size={9} weight="fill" color={marmalade[600]} />
              </View>
            ) : null}
            <RarityBadge rarity={cat.bestTier} size="sm" compact />
          </View>

          {cat.encounterCount > 1 ? (
            <Text style={[text.statSm, styles.count]}>{`×${cat.encounterCount}`}</Text>
          ) : null}
        </View>

        <Text style={[text.caption, styles.name, { color: c.text }]} numberOfLines={1}>
          {cat.nickname ?? 'Unnamed'}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: 5,
  },
  tile: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  noPhoto: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '34%',
    backgroundColor: photoScrim.cardBottom,
  },
  corner: {
    position: 'absolute',
    top: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  discovered: {
    width: 16,
    height: 16,
    borderRadius: radii.full,
    backgroundColor: marmalade[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    color: chrome.text,
    paddingHorizontal: 7,
    paddingBottom: 6,
  },
  name: {
    textAlign: 'center',
  },
});
