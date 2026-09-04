import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import {
  contextColors,
  perpetual,
  radii,
  spacing,
  staggerDelay,
  useReduceMotion,
  type ContextName,
} from '../theme';
import { GRID_META_HEIGHT } from './PhotoCard';

/**
 * Skeleton loaders.
 *
 * These replace circular spinners everywhere. Each skeleton matches the real layout's
 * geometry, so nothing jumps when the data lands — a spinner followed by a reflow is worse
 * than a placeholder that was already the right shape.
 *
 * The shimmer loop is isolated per block and memoized, so a grid of them cannot cascade
 * re-renders into the parent list.
 */

export const SkeletonBlock = React.memo(function SkeletonBlock({
  width,
  height,
  radius = radii.xs,
  index = 0,
  context = 'paper',
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  index?: number;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const pulse = useSharedValue(0.4);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0.6;
      return;
    }

    pulse.value = withDelay(
      staggerDelay(index),
      withRepeat(
        withTiming(0.85, {
          duration: perpetual.skeletonSweep.duration,
          easing: Easing.bezier(0.32, 0.72, 0, 1),
        }),
        -1,
        true
      )
    );

    return () => {
      cancelAnimation(pulse);
    };
  }, [index, pulse, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: c.sunken },
        animated,
        style,
      ]}
    />
  );
});

/** Matches PhotoCard's geometry exactly, so nothing shifts when the real card mounts. */
export const PhotoCardSkeleton = React.memo(function PhotoCardSkeleton({
  index = 0,
  context = 'paper',
}: {
  index?: number;
  context?: ContextName;
}) {
  const c = contextColors(context);

  return (
    <View style={[styles.card, { backgroundColor: c.surface }]}>
      <SkeletonBlock
        width="100%"
        height={0}
        index={index}
        context={context}
        style={styles.cardPhoto}
      />
      <View style={styles.cardMeta}>
        <SkeletonBlock width="68%" height={11} index={index} context={context} />
        <SkeletonBlock width="44%" height={9} index={index + 1} context={context} />
      </View>
    </View>
  );
});

/** Leaderboard / friends row. Hairline-separated, so no card geometry to match. */
export const SkeletonRow = React.memo(function SkeletonRow({
  index = 0,
  context = 'paper',
  showAvatar = true,
}: {
  index?: number;
  context?: ContextName;
  showAvatar?: boolean;
}) {
  return (
    <View style={styles.row}>
      {showAvatar ? (
        <SkeletonBlock width={40} height={40} radius={radii.md} index={index} context={context} />
      ) : null}
      <View style={styles.rowText}>
        <SkeletonBlock width="52%" height={12} index={index} context={context} />
        <SkeletonBlock width="30%" height={9} index={index + 1} context={context} />
      </View>
      <SkeletonBlock width={44} height={16} radius={radii.sm} index={index} context={context} />
    </View>
  );
});

/** Map pin placeholders at the last known viewport, so the map is not blank while loading. */
export const SkeletonPin = React.memo(function SkeletonPin({
  index = 0,
}: {
  index?: number;
}) {
  return <SkeletonBlock width={26} height={26} radius={radii.full} index={index} />;
});

export const SkeletonList = React.memo(function SkeletonList({
  count = 8,
  context = 'paper',
  showAvatar = true,
}: {
  count?: number;
  context?: ContextName;
  showAvatar?: boolean;
}) {
  const c = contextColors(context);

  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={
            i === 0
              ? undefined
              : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }
          }
        >
          <SkeletonRow index={i} context={context} showAvatar={showAvatar} />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  cardPhoto: {
    aspectRatio: 1,
    width: '100%',
    height: undefined,
    borderRadius: 0,
  },
  /**
   * The same fixed block a real grid tile carries, so the album does not jump as photos
   * land. See `GRID_META_HEIGHT` in PhotoCard for what the number is made of.
   */
  cardMeta: {
    height: GRID_META_HEIGHT + spacing.xs + spacing.xs + 2,
    paddingHorizontal: spacing.xs + 2,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs + 2,
    gap: spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
});
