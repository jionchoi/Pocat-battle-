import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

import type { Photo } from '../models';
import {
  contextColors,
  elevation,
  perpetual,
  press,
  radii,
  spacing,
  staggerDelay,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';
import { RarityBadge, RarityPips, ScoreChip } from './Badge';

/**
 * PhotoCard — the core content component (README section 6).
 *
 * Two variants: `grid` for the album, `feed` for the community stream.
 *
 * The photograph runs to the card's own edge. Tier used to be carried by a tinted shell
 * and a hairline ring around the image, which cost 12pt of a 110pt grid tile and made
 * every card read as a framed print; it is now a badge worn in the top-right corner of
 * the image itself, the same as on every other photo surface in the product.
 *
 * Tier is conveyed by badge colour, glyph silhouette AND label — never colour alone.
 */

export interface PhotoCardProps {
  photo: Photo;
  onPress: () => void;
  variant?: 'grid' | 'feed';
  /** Cascade index. Lists enter on a 60ms-per-index stagger, never all at once. */
  index?: number;
  /** Viewport gate for the Legendary sheen — see RaritySheen. */
  visible?: boolean;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
  /** Rendered under the meta row: reaction buttons in the feed, nothing in the grid. */
  footer?: React.ReactNode;
}

export const PhotoCard = React.memo(function PhotoCard({
  photo,
  onPress,
  variant = 'grid',
  index = 0,
  visible = true,
  context = 'paper',
  style,
  footer,
}: PhotoCardProps) {
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
      { translateY: press.translateY * pressed.value },
    ],
  }));

  const radius = variant === 'feed' ? radii.xl : radii.lg;

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
        accessibilityLabel={`${photo.catNickname}, ${photo.tier}, scored ${photo.scores.total}`}
        style={[
          styles.card,
          { backgroundColor: c.surface, borderRadius: radius },
          elevation(variant === 'feed' ? 'hairline' : 'flat', context),
        ]}
      >
        <View style={variant === 'feed' ? styles.photoFeed : styles.photoGrid}>
          <Image
            source={photo.imageUrl || undefined}
            contentFit="cover"
            transition={200}
            style={StyleSheet.absoluteFill}
            accessible
            accessibilityLabel={`Photo of ${photo.catNickname}`}
          />

          {/* Empty-photo state. Storage may be unconfigured locally, and a card with
              a blank hole reads as a bug rather than as a missing image. */}
          {!photo.imageUrl ? (
            <View style={[styles.noPhoto, { backgroundColor: c.sunken }]}>
              <Text style={[text.caption, { color: c.textFaint }]}>No image</Text>
            </View>
          ) : null}

          {photo.tier === 'Legendary' ? (
            <RaritySheen visible={visible} radius={radius} />
          ) : null}

          <View style={styles.corners} pointerEvents="none">
            <ScoreChip score={photo.scores.total} />
            <RarityBadge rarity={photo.tier} size="sm" compact={variant === 'grid'} />
          </View>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <Text
              style={[variant === 'feed' ? text.h3 : text.caption, styles.name, { color: c.text }]}
              numberOfLines={1}
            >
              {photo.catNickname}
            </Text>
            {variant === 'feed' ? <RarityPips rarity={photo.tier} context={context} /> : null}
          </View>

          {photo.caption ? (
            <Text style={[text.bodySm, { color: c.textMuted }]} numberOfLines={2}>
              {photo.caption}
            </Text>
          ) : null}

          {photo.badges.length > 0 ? (
            <Text style={[text.captionSm, { color: c.textFaint }]} numberOfLines={1}>
              {photo.badges.join(' · ')}
            </Text>
          ) : null}

          {footer}
        </View>
      </Pressable>
    </Animated.View>
  );
});

/**
 * RaritySheen — replaces the deleted `RarityGlow`.
 *
 * A masked, translated highlight rather than an outer glow: glows are banned, and this
 * is pure `transform` + `opacity` so it runs entirely on the UI thread.
 *
 * Isolated in its own memoized leaf and gated on `visible` so the loop can never
 * re-render the card, and so a scrolled-off card stops animating. A 200-card grid
 * animating every card is a frame-rate collapse.
 */
export const RaritySheen = React.memo(function RaritySheen({
  visible,
  radius,
}: {
  visible: boolean;
  radius: number;
}) {
  const sweep = useSharedValue(-1);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!visible || reduceMotion) {
      cancelAnimation(sweep);
      sweep.value = -1;
      return;
    }

    sweep.value = withRepeat(
      withDelay(
        perpetual.raritySheen.sweepDelay,
        withTiming(1.6, {
          duration: perpetual.raritySheen.duration,
          easing: Easing.inOut(Easing.ease),
        })
      ),
      -1,
      false
    );

    return () => {
      cancelAnimation(sweep);
    };
  }, [reduceMotion, sweep, visible]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: sweep.value * 260 }, { rotate: '18deg' }],
    // Fades in and out at the edges so the band never appears to pop into existence.
    opacity: Math.max(0, 0.34 - Math.abs(sweep.value) * 0.28),
  }));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <Animated.View style={[styles.sheen, animated]} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  corners: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xxs,
  },
  photoGrid: {
    width: '100%',
    aspectRatio: 1,
  },
  photoFeed: {
    width: '100%',
    aspectRatio: 4 / 5,
  },
  noPhoto: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    paddingHorizontal: spacing.xs + 2,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs + 2,
    gap: spacing.xxs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  name: {
    flexShrink: 1,
  },
  sheen: {
    position: 'absolute',
    top: -60,
    bottom: -60,
    left: -140,
    width: 56,
    backgroundColor: '#FFFFFF',
  },
});
