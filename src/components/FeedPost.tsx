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
import { Eye } from 'phosphor-react-native';

import type { PhotoWithAuthor, Reaction } from '../models';
import { Avatar } from './Avatar';
import { RarityBadge, ScoreChip } from './Badge';
import { VoteRow } from './VoteButton';
import {
  chrome,
  contextColors,
  layout,
  press,
  radii,
  spacing,
  staggerDelay,
  text,
  useReduceMotion,
} from '../theme';
import { compactNumber, relativeTime } from '../utils/format';

/**
 * A post on the feed.
 *
 * This is the third card shape in the product and the only one that is *not* primarily a
 * photograph with chrome on it. The rail poster and the album tile are things you scan;
 * a post is something you stop on — so it gets an author, a caption, a reaction bar you
 * can actually press, and the room to show all of them.
 *
 * ## Why this replaced the masonry wall
 *
 * The wall packed two ranked columns whose card heights fell with rank. It was legible
 * from across the room and it was the wrong shape for the job: at half width there was no
 * room for a caption, the author was a 9pt line, and reacting meant opening the photo
 * first. A feed whose whole purpose is community response cannot make responding a
 * second screen.
 *
 * Single column also buys virtualization back. The wall could not be a `FlatList` — a
 * masonry column is not a row — so it computed every card's y analytically and rendered
 * all of them. A post feed is a list of rows, so `FlatList` handles both windowing and
 * impression reporting, and roughly a hundred lines of packing arithmetic goes away.
 *
 * ## The corner grammar survives
 *
 * Score top-left, tier top-right, exactly as on every other photo surface. A reader who
 * has learned to read an album tile can read a post without being taught twice.
 */

/**
 * Aspect ratios cycle so the scroll has a rhythm.
 *
 * Not random and not uniform. A column of identical 4:5 crops reads as a contact sheet,
 * and a random height per card reads as broken layout — three ratios on a fixed cycle
 * gives variety that looks deliberate, because it is.
 */
const POST_ASPECTS = [4 / 5, 1, 3 / 4] as const;

export function postAspect(index: number): number {
  return POST_ASPECTS[index % POST_ASPECTS.length];
}

export const FeedPost = React.memo(function FeedPost({
  photo,
  myReaction,
  index = 0,
  isMine = false,
  onPress,
  onPressAuthor,
  onReact,
  style,
}: {
  photo: PhotoWithAuthor;
  myReaction: Reaction | null;
  index?: number;
  /** You cannot react to your own photo — the server rejects it too. */
  isMine?: boolean;
  onPress: () => void;
  onPressAuthor: () => void;
  onReact: (reaction: Reaction) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors('paper');
  const reduceMotion = useReduceMotion();

  const pressed = useSharedValue(0);
  const enter = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      enter.value = 1;
      return;
    }

    enter.value = withDelay(
      staggerDelay(index, 4),
      withTiming(1, { duration: 620, easing: Easing.bezier(0.32, 0.72, 0, 1) })
    );
  }, [enter, index, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 14 }],
  }));

  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - press.scale) * pressed.value }],
  }));

  return (
    <Animated.View style={[styles.post, animated, style]}>
      {/*
        The author leads. On the album a photo belongs to you and the header would be
        redundant; here the first question is whose cat this is, and the answer has to be
        above the picture rather than buried under it.
      */}
      <Pressable
        onPress={onPressAuthor}
        accessibilityRole="button"
        accessibilityLabel={`${photo.author.username}'s profile`}
        style={styles.header}
      >
        <Avatar uri={photo.author.avatarUrl} name={photo.author.username} size={36} />
        <View style={styles.headerBody}>
          <Text style={[text.h3, { color: c.text }]} numberOfLines={1}>
            {photo.author.username}
          </Text>
          <Text style={[text.captionSm, { color: c.textSubtle }]} numberOfLines={1}>
            {`${photo.catNickname} · ${relativeTime(photo.capturedAt)}`}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onPress}
        onPressIn={() => {
          pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, press.config);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${photo.catNickname} by ${photo.author.username}, scored ${photo.scores.total}, ${photo.tier}`}
      >
        <Animated.View
          style={[
            styles.photo,
            { aspectRatio: postAspect(index), backgroundColor: c.sunken },
            photoStyle,
          ]}
        >
          <Image
            source={photo.imageUrl || undefined}
            contentFit="cover"
            transition={220}
            style={StyleSheet.absoluteFill}
            accessible={false}
          />
          {!photo.imageUrl ? (
            <View style={styles.noPhoto}>
              <Text style={[text.caption, { color: c.textFaint }]}>No image</Text>
            </View>
          ) : null}

          <View style={styles.corners} pointerEvents="none">
            <ScoreChip score={photo.scores.total} />
            <RarityBadge rarity={photo.tier} size="sm" />
          </View>
        </Animated.View>
      </Pressable>

      {/*
        The reaction bar is the point of the post. Three buttons rather than one heart,
        because the mix is the interesting part — a photo that made two hundred people
        laugh is a different photo from one that made two hundred go "wow", and a single
        total throws that away.
      */}
      <View style={styles.actions}>
        <VoteRow
          reactions={photo.reactions}
          myReaction={myReaction}
          onReact={onReact}
          disabled={isMine}
        />
        <View style={styles.views}>
          <Eye size={13} weight="regular" color={c.textFaint} />
          <Text style={[text.statSm, { color: c.textFaint }]}>
            {compactNumber(photo.viewCount)}
          </Text>
        </View>
      </View>

      {photo.caption ? (
        <Text style={[text.body, styles.caption, { color: c.text }]} numberOfLines={2}>
          <Text style={[text.h3, { color: c.text }]}>{photo.catNickname}</Text>
          {`  ${photo.caption}`}
        </Text>
      ) : null}

      {photo.badges.length > 0 ? (
        <Text style={[text.captionSm, { color: c.textFaint }]} numberOfLines={1}>
          {photo.badges.join(' · ')}
        </Text>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  post: {
    paddingHorizontal: layout.gutter,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.xxs,
  },
  headerBody: {
    flex: 1,
    gap: 1,
  },
  photo: {
    width: '100%',
    borderRadius: radii.lg,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: chrome.fill,
  },
  noPhoto: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  views: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  caption: {
    // The nickname runs inline with the caption the way a handle does on a social post —
    // two stacked lines would make the cat's name look like a heading for the sentence.
    lineHeight: 20,
  },
});
