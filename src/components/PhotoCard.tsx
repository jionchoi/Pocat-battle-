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
  chrome,
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

/**
 * The grid tile's caption block is a fixed height, and this is it.
 *
 * Two lines of `caption` for the cat's name, a 4pt gap, and one line of `captionSm` for the
 * badges. Every album tile is therefore the same size whatever is written on it — which it
 * was not: a photo the scorer had labelled "Caught mid-yawn" grew a third line and stood
 * taller than the untagged photo beside it, so a two-column grid of the same square
 * photographs came out ragged.
 *
 * Reserved rather than measured. Sizing the block to its tallest *actual* content would make
 * the whole grid relayout as a badge lands, and letting `FlatList` size each row still leaves
 * the two cards within a row disagreeing. A constant is the only version where a row is a row.
 *
 * Keep in step with `text.caption` (15) and `text.captionSm` (13) if either changes; the
 * album skeleton is built from the same number so the grid does not jump when photos land.
 */
export const GRID_NAME_LINES = 2;
export const GRID_META_HEIGHT = 15 * GRID_NAME_LINES + 4 + 13;

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

  const grid = variant === 'grid';
  const radius = grid ? radii.lg : radii.xl;

  /** The one field that says whether `scores` and `tier` mean anything. */
  const scored = photo.scoredAt !== null;
  /** Empty until the player says which cat this is, which is a supported answer. */
  const name = photo.catNickname || 'Unidentified';

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
        accessibilityLabel={
          scored
            ? `${name}, ${photo.tier}, scored ${photo.scores.total}`
            : `${name}, not scored yet`
        }
        style={[
          styles.card,
          {
            backgroundColor: c.surface,
            borderRadius: radius,
            /*
             * A black outline around the whole card — photo and text together.
             *
             * It draws inside the box, so the image and the caption block both sit within it
             * and the stroke closes around whatever height the name has wrapped to. That is
             * the point of putting it here rather than on the meta strip: the card is one
             * object, and an outline that stopped at the photograph would cut it in half.
             *
             * Black only on paper. `chrome.fill` is this app's one opaque dark surface value
             * in the light context, and on an arena screen it would be a black line on a
             * near-black card — so the dark context keeps the raised hairline that is legible
             * there instead.
             */
            borderWidth: 1,
            borderColor: context === 'arena' ? c.hairlineHi : chrome.fill,
          },
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
            accessibilityLabel={`Photo of ${name}`}
          />

          {/* Empty-photo state. Storage may be unconfigured locally, and a card with
              a blank hole reads as a bug rather than as a missing image. */}
          {!photo.imageUrl ? (
            <View style={[styles.noPhoto, { backgroundColor: c.sunken }]}>
              <Text style={[text.caption, { color: c.textFaint }]}>No image</Text>
            </View>
          ) : null}

          {scored && photo.tier === 'Legendary' ? (
            <RaritySheen visible={visible} radius={radius} />
          ) : null}

          {/*
            The tier badge is withheld until there is a score, not just the number.

            `tier` is filled in as 'Common' on an unscored row for the same reason `scores`
            is filled in as zeroes — the client's type wants a value — so drawing it would
            label every photograph waiting its turn as the worst possible outcome. The lock
            says the honest thing, and it says it in the one corner that already means
            "this photo's score".
          */}
          <View style={styles.corners} pointerEvents="none">
            <ScoreChip score={photo.scores.total} scored={scored} />
            {scored ? (
              <RarityBadge rarity={photo.tier} size="sm" compact={variant === 'grid'} />
            ) : null}
          </View>
        </View>

        <View style={[styles.meta, grid && styles.metaGrid]}>
          <View style={styles.metaRow}>
            {/*
              Two lines, and the grid tile reserves both whether or not the name needs them.

              One line truncated most cat names an owner actually types — the tile is roughly
              half the screen wide and the name shares its line with a rarity pip — and a
              clipped name on a card whose entire job is to say which cat this is loses the
              one thing the caption carries. Two lines fixes that; reserving them is what
              stops a short name and a long one producing two different card heights. See
              `GRID_META_HEIGHT`.
            */}
            <Text
              style={[
                variant === 'feed' ? text.h3 : text.caption,
                styles.name,
                { color: c.text },
              ]}
              numberOfLines={GRID_NAME_LINES}
            >
              {name}
            </Text>
            {variant === 'feed' && scored ? (
              <RarityPips rarity={photo.tier} context={context} />
            ) : null}
          </View>

          {/*
            The grid tile gets exactly one metadata line and always gets it, even when there
            is nothing to put on it. Badges lead — they are the scorer's verdict and the more
            interesting half — with the player's own caption behind them, and a blank line
            holding the space open when the photograph has neither. That blank is the point:
            it is what makes an untagged tile the same height as a tagged one.
          */}
          {grid ? (
            <Text style={[text.captionSm, { color: c.textFaint }]} numberOfLines={1}>
              {photo.badges.length > 0 ? photo.badges.join(' · ') : (photo.caption ?? '')}
            </Text>
          ) : (
            <>
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
            </>
          )}

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
  /** See `GRID_META_HEIGHT`. The one thing that makes two album tiles the same object. */
  metaGrid: {
    height: GRID_META_HEIGHT + spacing.xs + spacing.xs + 2,
    justifyContent: 'flex-start',
  },
  metaRow: {
    flexDirection: 'row',
    /*
     * Top-aligned, not centred. A name that has wrapped to two lines is taller than the pip
     * beside it, and centring would float the pip into the middle of the name's second line
     * instead of keeping it on the first, where it reads as belonging to the row.
     */
    alignItems: 'flex-start',
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
