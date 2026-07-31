import React, { useCallback, useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import {
  Cards,
  MapTrifold,
  Trophy,
  UserCircle,
  type IconProps,
} from 'phosphor-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import {
  bone,
  elevation,
  fern,
  glass,
  hitSlopFor,
  icon,
  innerHighlight,
  layout,
  press,
  radii,
  spring,
  text,
  timing,
  useReduceMotion,
} from '../theme';

const TAB_ICONS: Record<string, React.ComponentType<IconProps>> = {
  MapTab: MapTrifold,
  AlbumTab: Cards,
  ChallengesTab: Trophy,
  ProfileTab: UserCircle,
};

const TAB_LABELS: Record<string, string> = {
  MapTab: 'Map',
  AlbumTab: 'Album',
  ChallengesTab: 'Challenges',
  ProfileTab: 'Profile',
};

/**
 * Screens that commit to the Arena context hide all chrome.
 *
 * These are route names from the param lists, not component names — React Navigation
 * reports the route name, and using the component name here silently never matches.
 */
const IMMERSIVE_ROUTES = new Set(['Capture', 'ScoreResult']);

const BAR_HEIGHT = 62;

/**
 * The Fluid Island tab bar.
 *
 * Nav bars glued edge-to-edge against a screen edge are a banned layout. This is the
 * native translation of the floating-glass-pill pattern: detached from the bottom edge,
 * inset from both sides, lifted clear of the safe area, real glass rather than a flat
 * translucent fill.
 *
 * The active indicator is a single pill that SLIDES between slots on a soft spring — it
 * does not fade out and in per tab. Entering an immersive route slides the whole bar
 * off-screen downward.
 *
 * `BlurView` is safe here because the bar is absolutely positioned and never scrolls.
 */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const routeCount = state.routes.length;
  const indicator = useSharedValue(state.index);
  const offscreen = useSharedValue(0);
  /** Measured once on layout so the indicator can slide via translateX, never `left`. */
  const slotWidth = useSharedValue(0);

  const focusedRoute = state.routes[state.index];
  const nestedRoute = focusedRoute.state?.routes?.[focusedRoute.state.index ?? 0];
  const immersive = nestedRoute ? IMMERSIVE_ROUTES.has(nestedRoute.name) : false;

  useEffect(() => {
    indicator.value = reduceMotion
      ? state.index
      : withSpring(state.index, spring.soft);
  }, [indicator, reduceMotion, state.index]);

  useEffect(() => {
    offscreen.value = withTiming(
      immersive ? 1 : 0,
      immersive ? timing.exit : timing.enter
    );
  }, [immersive, offscreen]);

  const barStyle = useAnimatedStyle(() => ({
    opacity: 1 - offscreen.value,
    transform: [{ translateY: offscreen.value * (BAR_HEIGHT + insets.bottom + 32) }],
  }));

  /**
   * Slides on `translateX` only. Animating `left` would trigger layout on every frame,
   * which is exactly what the motion spec forbids.
   */
  const indicatorStyle = useAnimatedStyle(() => ({
    width: slotWidth.value,
    transform: [{ translateX: indicator.value * slotWidth.value }],
    opacity: slotWidth.value > 0 ? 1 : 0,
  }));

  const onBarLayout = useCallback(
    (event: LayoutChangeEvent) => {
      slotWidth.value = event.nativeEvent.layout.width / routeCount;
    },
    [routeCount, slotWidth]
  );

  return (
    <Animated.View
      pointerEvents={immersive ? 'none' : 'auto'}
      style={[
        styles.wrap,
        {
          bottom: insets.bottom + layout.tabBarLift,
          left: layout.tabBarInset,
          right: layout.tabBarInset,
        },
        elevation('floating', 'bone'),
        barStyle,
      ]}
    >
      <BlurView
        intensity={glass.intensity}
        tint={glass.tintLight}
        style={styles.glass}
        onLayout={onBarLayout}
      >
        {/* 1px inner hairline + inset top highlight: real edge refraction, not just blur. */}
        <View
          style={[styles.hairline, innerHighlight(bone.innerHighlight)]}
          pointerEvents="none"
        />

        <Animated.View
          style={[styles.indicator, indicatorStyle]}
          pointerEvents="none"
        >
          <View style={styles.indicatorPill} />
        </Animated.View>

        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;

            return (
              <TabItem
                key={route.key}
                routeName={route.name}
                focused={focused}
                badgeCount={options.tabBarBadge as number | undefined}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
              />
            );
          })}
        </View>
      </BlurView>
    </Animated.View>
  );
}

interface TabItemProps {
  routeName: string;
  focused: boolean;
  badgeCount?: number;
  onPress: () => void;
}

/**
 * A single slot.
 *
 * Active: Phosphor `fill` weight, accent color, label visible.
 * Inactive: Phosphor `light` weight, faint color, label hidden.
 * Every tap gets the same tactile compression as any other pressable in the product.
 */
const TabItem = React.memo(function TabItem({
  routeName,
  focused,
  badgeCount,
  onPress,
}: TabItemProps) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);
  const label = useSharedValue(focused ? 1 : 0);

  const Glyph = TAB_ICONS[routeName] ?? MapTrifold;
  const labelText = TAB_LABELS[routeName] ?? routeName;

  useEffect(() => {
    label.value = reduceMotion
      ? focused
        ? 1
        : 0
      : withSpring(focused ? 1 : 0, spring.snap);
  }, [focused, label, reduceMotion]);

  const onPressIn = useCallback(() => {
    pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
  }, [pressed, reduceMotion]);

  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, press.config);
  }, [pressed]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - (1 - press.scale) * pressed.value },
      { translateY: press.translateY * pressed.value },
    ],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: label.value,
    transform: [{ translateY: (1 - label.value) * 4 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={hitSlopFor(BAR_HEIGHT)}
      accessibilityRole="tab"
      accessibilityLabel={labelText}
      accessibilityState={{ selected: focused }}
      style={styles.item}
    >
      <Animated.View style={[styles.itemContent, contentStyle]}>
        <View>
          <Glyph
            size={icon.size.lg}
            color={focused ? fern[600] : bone.textFaint}
            weight={focused ? icon.weightActive : icon.weightDefault}
          />
          {badgeCount ? (
            <View style={styles.badge}>
              <Text style={[text.stat, styles.badgeText]}>
                {badgeCount > 9 ? '9+' : String(badgeCount)}
              </Text>
            </View>
          ) : null}
        </View>

        <Animated.Text
          numberOfLines={1}
          style={[text.caption, styles.label, { color: fern[600] }, labelStyle]}
        >
          {labelText}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    height: BAR_HEIGHT,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  glass: {
    flex: 1,
    borderRadius: radii.full,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  hairline: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: bone.hairline,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorPill: {
    width: 46,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: fern[100],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  label: {
    fontSize: 9,
    lineHeight: 11,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -6,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    /** Square-ish, not a pill. Pill "New"/"Beta" badges are a flagged cliche. */
    borderRadius: radii.xs,
    backgroundColor: fern[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    lineHeight: 11,
  },
});
