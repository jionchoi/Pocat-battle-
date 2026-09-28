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
import { LinearGradient } from 'expo-linear-gradient';
import { PawPrint } from 'phosphor-react-native';

import { REACTIONS, REACTION_EMOJI } from '../constants/game';
import { SHOW_PLACEHOLDERS } from '../constants/placeholders';
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
 * **A real gradient, and it used to be two flat blocks.** The intent was always a ramp that
 * reaches zero by the halfway mark and leaves the subject untouched — but it was built as two
 * bottom-anchored views with solid `backgroundColor`s, one 55% tall and one 32%, stacked. A
 * flat colour does not fall off. What that actually drew was a black box across the bottom
 * half of every card with a hard edge where the taller block ended, which is the opposite of
 * a scrim: it dirtied the photograph instead of holding the type over it.
 *
 * `expo-linear-gradient` is already a dependency and `PhotoDetailScreen` was already using it
 * for exactly this, so the ramp is a real ramp now and the three stops are the same ones —
 * transparent, the light stop, then the dense one at the base.
 *
 * `locations` rather than even thirds: the transparent half has to stay transparent, so the
 * ramp does not start until the fall-off point and then accelerates into the foot where the
 * text actually sits.
 */
const Scrim = React.memo(function Scrim({
  variant = 'card',
}: {
  variant?: 'card' | 'poster';
}) {
  const poster = variant === 'poster';

  return (
    <LinearGradient
      pointerEvents="none"
      colors={[
        'rgba(0, 0, 0, 0)',
        poster ? photoScrim.posterTop : photoScrim.cardTop,
        poster ? photoScrim.posterBottom : photoScrim.cardBottom,
      ]}
      locations={poster ? [0.45, 0.72, 1] : [0.55, 0.8, 1]}
      style={StyleSheet.absoluteFill}
    />
  );
});

/** Empty-photo state. Storage may be unconfigured, and a blank hole reads as a bug. */
const NoPhoto = React.memo(function NoPhoto({ context }: { context: ContextName }) {
  const c = contextColors(context);

  return (
    <View style={[StyleSheet.absoluteFill, styles.noPhoto, { backgroundColor: c.sunken }]}>
      <Text style={[text.caption, { color: c.textFaint }]}>No image</Text>
    </View>
  );
});

/**
 * What people said, at poster size.
 *
 * The faces themselves and one total, not a count per reaction. Per-reaction counts are the
 * right call in the reaction *bar*, where there is a whole row for them and pressing one is
 * the point; on a rank-3 poster at a third of the screen width there is no row — the old
 * version printed three icon-and-count pairs beside a score, and each pair got about eleven
 * points of width. The stack keeps the mix legible (which faces, in what order) and spends
 * one number instead of three.
 *
 * Two faces, not three. The card is smaller than a feed post's summary and the leading two
 * already answer what kind of photo this is.
 *
 * Zero counts are dropped rather than drawn as `0`, so a photo nobody has reacted to yet
 * shows nothing instead of a row of noughts.
 */
const POSTER_FACES = 2;

const ReactionRow = React.memo(function ReactionRow({
  photo,
  tone,
  size = 12,
}: {
  photo: PhotoWithAuthor;
  tone: 'onPhoto' | 'onPaper';
  size?: number;
}) {
  const onPhoto = tone === 'onPhoto';
  const color = onPhoto ? 'rgba(255,255,255,0.9)' : contextColors('paper').text;

  const shown = REACTIONS.filter((key) => (photo.reactions[key] ?? 0) > 0)
    .sort((a, b) => (photo.reactions[b] ?? 0) - (photo.reactions[a] ?? 0))
    .slice(0, POSTER_FACES);

  if (shown.length === 0) return null;

  const total = REACTIONS.reduce((sum, key) => sum + (photo.reactions[key] ?? 0), 0);

  return (
    <View style={styles.reactionRow}>
      {shown.map((key) => (
        <Text
          key={key}
          allowFontScaling={false}
          style={[styles.reactionFace, { fontSize: size, lineHeight: size * 1.25 }]}
        >
          {REACTION_EMOJI[key]}
        </Text>
      ))}
      <Text style={[text.statSm, { color }]}>{compactNumber(total)}</Text>
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

  /** The one field that says whether `scores` and `tier` mean anything. See `PhotoCard`. */
  const scored = photo.scoredAt !== null;

  return (
    <Animated.View style={[motion.animated, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={motion.onPressIn}
        onPressOut={motion.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={
          scored
            ? `Number ${rank}, ${photo.catNickname} by ${photo.author.username}, scored ${photo.scores.total}, ${photo.tier}`
            : `Number ${rank}, ${photo.catNickname} by ${photo.author.username}, not scored yet`
        }
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
          {scored ? <RarityBadge rarity={photo.tier} size="sm" compact={compact} /> : null}
        </View>

        {/*
          Two lines about the cat, and neither is drawn empty.

          It used to be the cat's name over "author · tier", which spent the poster's only
          two lines on things the reader can get elsewhere: the tier is already a badge in
          the top corner of this same card, and the author is a tap away on the photo. What
          is *not* anywhere else is what the app noticed — the Dex name it matched the animal
          to, and the tag the scorer put on the moment ("Caught mid-yawn"). Those are the two
          lines now.

          Both are conditional, and that is the point rather than a nicety. A cat nobody has
          identified has no Dex entry, and a photograph the scorer found nothing remarkable in
          has no tag. Printing a placeholder for either — "Unidentified", "No tags" — fills
          the poster with the app apologising. The line simply is not there, and the
          photograph gets the space.
        */}
        <View style={styles.posterFoot} pointerEvents="none">
          {photo.catNickname ? (
            <Text style={[text.h3, styles.posterName]} numberOfLines={1}>
              {photo.catNickname}
            </Text>
          ) : null}

          {photo.badges.length > 0 ? (
            <Text style={[text.captionSm, styles.posterMeta]} numberOfLines={1}>
              {photo.badges.join(' · ')}
            </Text>
          ) : null}

          <View style={styles.posterScoreRow}>
            {/*
              A number here means a verdict. An unscored capture carries a zero it did not
              earn, so the poster said "0" where the score goes — see `ScoreChip`, which has
              drawn a lock for this case all along.

              Run up from 13pt: it is the one figure on the card that is the card's whole
              claim, and at caption size it was losing to the cat's name above it.
            */}
            <Text style={[text.statMd, styles.posterScore]}>
              {scored ? photo.scores.total : '—'}
            </Text>
            {/* The faces are the first thing to go when the card narrows — a stack and a
                total do not fit beside a score at a third of the screen width. */}
            {compact ? null : <ReactionRow photo={photo} tone="onPhoto" />}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

/**
 * An empty slot in the trending bento.
 *
 * The block is a fixed five — two across, then three — and size encodes rank, so a feed with
 * only two hot photographs used to draw two cards beside a stretch of page. That reads as a
 * layout bug rather than as a quiet week, and it makes the bento impossible to *look at*
 * before there is real traffic, which is the state the whole thing is being designed in.
 *
 * So the unfilled slots are drawn: same aspect, same radius, same rank disc in the same
 * corner, and nothing in them. Hairline and dashed, because a solid grey block would read as
 * a photograph that failed to load — a dashed outline is the one shape that says "this space
 * is reserved" rather than "this is broken".
 *
 * Gated on `SHOW_PLACEHOLDERS`. With the flag off the slot renders as a bare spacer, which is
 * what shipped before and what should ship again the day the feed is busy enough not to need
 * this. See `constants/placeholders.ts`.
 */
export const TrendingSlot = React.memo(function TrendingSlot({
  rank,
  aspect = 3 / 4,
  style,
}: {
  rank: number;
  aspect?: number;
  style?: StyleProp<ViewStyle>;
}) {
  if (!SHOW_PLACEHOLDERS) return <View style={style} />;

  return (
    <View
      // Not `accessibilityElementsHidden`: a reader arriving here should be told the ranking
      // is short rather than silently skipping a hole in the grid.
      accessible
      accessibilityLabel={`Number ${rank}. Nothing is ranked here yet.`}
      style={[styles.slot, { aspectRatio: aspect }, style]}
    >
      <View style={styles.slotTopRow} pointerEvents="none">
        <View style={styles.slotRankDisc}>
          <Text style={[text.statSm, styles.slotRank]}>{rank}</Text>
        </View>
      </View>

      <View style={styles.slotBody} pointerEvents="none">
        <PawPrint size={20} weight="fill" color={contextColors('paper').textFaint} />
        <Text style={[text.captionSm, styles.slotLabel]} numberOfLines={2}>
          Open spot
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  /* --- shared --- */
  /**
   * Emoji sit high in their line box on both platforms, and they ignore `color`. Pinning the
   * line height to the size is what keeps a face vertically centred against the tabular
   * numeral beside it; `allowFontScaling={false}` at the call site keeps it inside a poster
   * that cannot grow.
   */
  reactionFace: {
    textAlign: 'center',
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

  /* --- the empty slot --- */
  slot: {
    width: '100%',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: contextColors('paper').hairlineHi,
    backgroundColor: contextColors('paper').sunkenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotTopRow: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
  },
  slotRankDisc: {
    width: 20,
    height: 20,
    borderRadius: radii.full,
    backgroundColor: contextColors('paper').sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotRank: {
    color: contextColors('paper').textFaint,
  },
  slotBody: {
    alignItems: 'center',
    gap: 5,
  },
  slotLabel: {
    color: contextColors('paper').textFaint,
    textAlign: 'center',
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
    fontSize: 18,
    lineHeight: 21,
  },

});
