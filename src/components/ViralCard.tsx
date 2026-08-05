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
import { Heart, Smiley, StarFour } from 'phosphor-react-native';

import type { PhotoWithAuthor } from '../models';
import { RarityBadge, ScoreChip } from './Badge';
import {
  chrome,
  contextColors,
  elevation,
  photoScrim,
  press,
  radii,
  spacing,
  staggerDelay,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';
import { compactNumber } from '../utils/format';

/**
 * The trending rail's poster card.
 *
 * Not a variant of `PhotoCard`. That component is a *catalogue* card — it leads with the
 * app's own score, which is the right emphasis in the album where you are looking at your
 * own collection. The rail leads with rank and with what the community did. Forcing both
 * jobs through one component is how a card ends up with eleven props and no point of view.
 *
 * It is not a variant of `FeedPost` either, and the split is the whole design of this
 * screen: a poster is for *scanning* and a post is for *stopping*. A poster has no room
 * for a caption or a pressable reaction bar, and a post has no use for a rank numeral.
 *
 * The photograph runs to the card's own edge. The old double-bezel put a tinted shell and
 * a hairline between the image and the world, which cost 10pt of a 148pt poster and made
 * every card read as a framed print — the rail wants the photo to be the card, and tier
 * is carried by the badge instead.
 */

/* -------------------------------------------------------------------------- */
/* Shared parts                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Legibility scrim under overlaid text.
 *
 * Two stacked stops rather than one flat wash: a single black overlay across the bottom
 * third visibly dirties the photo, whereas a fall-off that reaches zero by the halfway
 * mark leaves the subject untouched. RN has no background gradient, so the ramp is real
 * layers — the cost of that is why there are two and not eight.
 */
const Scrim = React.memo(function Scrim({
  variant = 'card',
}: {
  variant?: 'card' | 'poster';
}) {
  const poster = variant === 'poster';

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.scrimUpper,
          {
            height: poster ? '55%' : '45%',
            backgroundColor: poster ? photoScrim.posterTop : photoScrim.cardTop,
          },
        ]}
      />
      <View
        style={[
          styles.scrimLower,
          {
            height: poster ? '32%' : '26%',
            backgroundColor: poster ? photoScrim.posterBottom : photoScrim.cardBottom,
          },
        ]}
      />
    </View>
  );
});

/** Empty-photo state. Storage may be unconfigured, and a blank hole reads as a bug. */
const NoPhoto = React.memo(function NoPhoto({ context }: { context: ContextName }) {
  const c = contextColors(context);

  return (
    <View style={[StyleSheet.absoluteFillObject, styles.noPhoto, { backgroundColor: c.sunken }]}>
      <Text style={[text.caption, { color: c.textFaint }]}>No image</Text>
    </View>
  );
});

/**
 * Per-reaction counts.
 *
 * Split into the three reactions rather than summed into one "reactions" figure: the mix
 * is the interesting part — a photo that made 200 people laugh is a different photo from
 * one that made 200 people go "wow", and a single total throws that away. Zero counts are
 * dropped rather than shown as `0`, so a new photo does not display a row of failures.
 */
const REACTION_GLYPHS = [
  { key: 'laugh', Glyph: Smiley },
  { key: 'love', Glyph: Heart },
  { key: 'wow', Glyph: StarFour },
] as const;

const ReactionRow = React.memo(function ReactionRow({
  photo,
  tone,
  size = 11,
}: {
  photo: PhotoWithAuthor;
  tone: 'onPhoto' | 'onPaper';
  size?: number;
}) {
  const onPhoto = tone === 'onPhoto';
  const color = onPhoto ? 'rgba(255,255,255,0.9)' : contextColors('paper').text;

  const shown = REACTION_GLYPHS.filter(({ key }) => photo.reactions[key] > 0);
  if (shown.length === 0) return null;

  return (
    <View style={styles.reactionRow}>
      {shown.map(({ key, Glyph }) => (
        <View key={key} style={styles.reaction}>
          <Glyph size={size} weight="fill" color={color} />
          <Text style={[text.statSm, { color }]}>
            {compactNumber(photo.reactions[key])}
          </Text>
        </View>
      ))}
    </View>
  );
});

/** Entry + press physics for the poster. */
function useCardMotion(index: number) {
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
      { translateY: (1 - enter.value) * 14 },
      { scale: 1 - (1 - press.scale) * pressed.value },
      { translateY: press.translateY * pressed.value },
    ],
  }));

  return {
    animated,
    onPressIn: () => {
      pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
    },
    onPressOut: () => {
      pressed.value = withSpring(0, press.config);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Trending bento                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A trending poster: everything worn on the image itself.
 *
 * Rank rides top-left as a numbered disc, tier top-right, and the name, author and score
 * stack in the scrim at the foot. Nothing sits below the photo — these are meant to scan
 * as posters, and a caption strip under each one turns the block into search results.
 *
 * The card has no width of its own. It is laid out by the bento grid that owns it, which
 * gives each row `flex: 1` cards — so the same component is a half-width hero in the top
 * row and a third-width tile in the second, and the size difference is what encodes rank.
 *
 * `compact` drops the tier label to a glyph disc. At a third of the screen a pill reading
 * "LEGENDARY" is most of the card's width.
 */
export const TrendingCard = React.memo(function TrendingCard({
  photo,
  rank,
  index = 0,
  aspect = 3 / 4,
  compact = false,
  onPress,
  style,
}: {
  photo: PhotoWithAuthor;
  rank: number;
  index?: number;
  aspect?: number;
  compact?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const motion = useCardMotion(index);

  return (
    <Animated.View style={[motion.animated, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={motion.onPressIn}
        onPressOut={motion.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`Number ${rank}, ${photo.catNickname} by ${photo.author.username}, scored ${photo.scores.total}, ${photo.tier}`}
        style={[styles.trendingCard, { aspectRatio: aspect }]}
      >
        <Image
          source={photo.imageUrl || undefined}
          contentFit="cover"
          transition={220}
          style={StyleSheet.absoluteFill}
          accessible={false}
        />
        {!photo.imageUrl ? <NoPhoto context="paper" /> : null}

        <Scrim variant="poster" />

        <View style={styles.posterTopRow} pointerEvents="none">
          <View style={styles.rankDisc}>
            <Text style={[text.statSm, styles.rankNumeral]}>{rank}</Text>
          </View>
          <RarityBadge rarity={photo.tier} size="sm" compact={compact} />
        </View>

        <View style={styles.posterFoot} pointerEvents="none">
          <Text style={[text.h3, styles.posterName]} numberOfLines={1}>
            {photo.catNickname}
          </Text>
          <Text style={[text.captionSm, styles.posterMeta]} numberOfLines={1}>
            {compact ? photo.tier : `${photo.author.username} · ${photo.tier}`}
          </Text>

          <View style={styles.posterScoreRow}>
            <Text style={[text.h3, styles.posterScore]}>{photo.scores.total}</Text>
            {/* The reaction glyphs are the first thing to go when the card narrows —
                three icon-and-count pairs do not fit beside a score at a third width. */}
            {compact ? null : <ReactionRow photo={photo} tone="onPhoto" />}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  /* --- shared --- */
  scrimUpper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrimLower: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  noPhoto: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  cardTopRow: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xxs,
  },

  /* --- trending bento --- */
  trendingCard: {
    width: '100%',
    borderRadius: radii.xl,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: chrome.fill,
  },
  posterTopRow: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xxs,
  },
  rankDisc: {
    width: 20,
    height: 20,
    borderRadius: radii.full,
    backgroundColor: chrome.onPhotoStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNumeral: {
    color: chrome.text,
  },
  posterFoot: {
    padding: 9,
    gap: 3,
  },
  posterName: {
    color: chrome.text,
    fontSize: 14,
    lineHeight: 18,
  },
  posterMeta: {
    color: 'rgba(255,255,255,0.75)',
  },
  posterScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: spacing.xs,
  },
  posterScore: {
    color: chrome.text,
    fontSize: 13,
    lineHeight: 16,
  },

});
