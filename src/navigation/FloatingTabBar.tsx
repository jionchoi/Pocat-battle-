import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Fire,
  MapPin,
  PawPrint,
  Trophy,
  UserCircle,
  type IconProps,
} from 'phosphor-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StackActions } from '@react-navigation/native';

import {
  chrome,
  elevation,
  hitSlopFor,
  layout,
  marmalade,
  paper,
  press,
  radii,
  spacing,
  spring,
  text,
  timing,
  useReduceMotion,
} from '../theme';

const TAB_ICONS: Record<string, React.ComponentType<IconProps>> = {
  HomeTab: Fire,
  MapTab: MapPin,
  ChallengesTab: Trophy,
  ProfileTab: UserCircle,
};

/**
 * The bar carries no visible labels — four glyphs plus the shutter leaves roughly 45pt
 * per slot, and a legible label does not fit in it. The names survive as accessibility
 * labels, which is where a screen reader looks for them anyway.
 */
const TAB_LABELS: Record<string, string> = {
  HomeTab: 'Viral',
  MapTab: 'Map',
  ChallengesTab: 'Challenges',
  ProfileTab: 'You',
};

/**
 * Screens that commit to the Arena context hide all chrome.
 *
 * These are route names from the param lists, not component names — React Navigation
 * reports the route name, and using the component name here silently never matches.
 */
const IMMERSIVE_ROUTES = new Set(['Capture', 'ScoreResult']);

const BAR_HEIGHT = layout.tabBarHeight;
const FAB_SIZE = 56;
/** How far the shutter rises above the pill's top edge. */
const FAB_RISE = 24;
/**
 * The gap the four tabs leave in the middle of the row. Wider than the shutter itself, so
 * a glyph never sits under the disc and the two inner tabs are not crowded by it.
 */
const FAB_SLOT = 76;
const ICON_SIZE = 21;

/**
 * The floating tab bar.
 *
 * Nav bars glued edge-to-edge against a screen edge are a banned layout: this is a
 * detached dark pill, inset from both sides and lifted clear of the safe area, with the
 * capture shutter breaking out of its top edge in the centre.
 *
 * The shutter is deliberately *not* a fifth tab. Taking a photo is the only thing in this
 * product that leaves the tab tree entirely, and it is the thing the whole app exists to
 * do — so it gets the centre position, its own shape, its own colour and its own plane,
 * rising clear of the pill rather than sitting flush in the row.
 *
 * Four tabs fit around it because the album gave up its slot. Its stack is still mounted
 * and still navigable; it is reached from Profile now (see `HIDDEN_TABS`).
 *
 * Entering an immersive route slides the whole assembly off-screen downward.
 */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const offscreen = useSharedValue(0);

  const focusedRoute = state.routes[state.index];
  const nestedRoute = focusedRoute.state?.routes?.[focusedRoute.state.index ?? 0];
  const immersive = nestedRoute ? IMMERSIVE_ROUTES.has(nestedRoute.name) : false;

  useEffect(() => {
    offscreen.value = withTiming(
      immersive ? 1 : 0,
      immersive ? timing.exit : timing.enter
    );
  }, [immersive, offscreen]);

  const travel = BAR_HEIGHT + FAB_SIZE + insets.bottom + 40;

  const assemblyStyle = useAnimatedStyle(() => ({
    opacity: 1 - offscreen.value,
    transform: [{ translateY: offscreen.value * travel }],
  }));

  const openCamera = useCallback(() => {
    /*
     * `initial: false` is load-bearing, and its absence was a trap.
     *
     * Navigating straight to a screen inside a stack that has not been rendered yet makes
     * that screen the stack's *initial* route — so the map tab held `[Capture]` rather than
     * `[Map, Capture]`, with nothing underneath to go back to. Everything downstream then
     * misbehaved in ways that looked unrelated: the reveal could not return to the map and
     * fell through to "that result has expired", and pressing the Map tab reopened the camera
     * because a one-route stack has index 0 and never gets popped to its top.
     */
    navigation.navigate('MapTab', { screen: 'Capture', initial: false });
  }, [navigation]);

  // Every tab is in the bar. The album used to be a hidden fifth one, which is why it had
  // no way back — it is a set of pushable screens now, not a place.
  const visible = state.routes;
  const half = Math.ceil(visible.length / 2);

  const renderTab = (route: (typeof visible)[number]) => {
    const index = state.routes.indexOf(route);
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
          if (event.defaultPrevented) return;

          /*
           * A tab is a destination, not a bookmark: pressing one shows that tab's own
           * screen, whether or not it is the tab you are already on. Without this, a stack
           * left three screens deep is what you get back when you return to it — the
           * player pressed "Map" and landed on somebody's profile.
           *
           * The nested stack is reset before the switch. It is addressed by its own key so
           * the action reaches the right navigator even while it sits in the background;
           * a tab never visited has no state to reset and is already at its root.
           */
          const nested = route.state;
          if (nested && 'key' in nested && nested.key && (nested.index ?? 0) > 0) {
            navigation.dispatch({
              ...StackActions.popToTop(),
              target: nested.key,
            });
          }

          if (!focused) {
            navigation.navigate(route.name);
          }
        }}
      />
    );
  };

  return (
    <Animated.View
      pointerEvents={immersive ? 'none' : 'box-none'}
      style={[
        styles.assembly,
        {
          bottom: insets.bottom + layout.tabBarLift,
          left: layout.tabBarInset,
          right: layout.tabBarInset,
        },
        assemblyStyle,
      ]}
    >
      <View style={[styles.bar, elevation('floating', 'paper')]}>
        {visible.slice(0, half).map(renderTab)}
        {/* Holds the centre open. The shutter is absolutely positioned so it can break
            the pill's top edge, which means it cannot reserve its own width in the row. */}
        <View style={styles.fabSlot} />
        {visible.slice(half).map(renderTab)}
      </View>

      <Shutter onPress={openCamera} />
    </Animated.View>
  );
}

/**
 * The capture shutter.
 *
 * Coral fill and a white ring. The ring is what reads as the disc punching through the
 * pill rather than resting on it — it does the separating work on its own, so the disc
 * carries the same neutral shadow as the pill rather than a glow tinted to its own hue.
 */
const Shutter = React.memo(function Shutter({ onPress }: { onPress: () => void }) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - (1 - press.scale) * pressed.value },
      { translateY: press.translateY * pressed.value },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, press.config);
      }}
      accessibilityRole="button"
      accessibilityLabel="Photograph a cat"
      style={styles.shutterHit}
    >
      <Animated.View style={[styles.shutter, elevation('floating', 'paper'), animated]}>
        {/*
          A paw, not a camera. Every phone already has a camera button and it says nothing
          about what this one is for — the paw says "cat" at 24pt with no label, which is
          the whole job of the centre glyph.
        */}
        <PawPrint size={24} weight="fill" color={chrome.text} />
      </Animated.View>
    </Pressable>
  );
});

interface TabItemProps {
  routeName: string;
  focused: boolean;
  badgeCount?: number;
  onPress: () => void;
}

/**
 * A single slot.
 *
 * Active: Phosphor `fill` weight in the accent. Inactive: `regular` weight in the muted
 * chrome grey. Weight and colour change together, so the active tab is legible in
 * greyscale as well as in colour.
 */
const TabItem = React.memo(function TabItem({
  routeName,
  focused,
  badgeCount,
  onPress,
}: TabItemProps) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);
  const active = useSharedValue(focused ? 1 : 0);

  const Glyph = TAB_ICONS[routeName] ?? MapPin;
  const labelText = TAB_LABELS[routeName] ?? routeName;

  useEffect(() => {
    active.value = reduceMotion
      ? focused
        ? 1
        : 0
      : withSpring(focused ? 1 : 0, spring.snap);
  }, [active, focused, reduceMotion]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: (1 + active.value * 0.08) * (1 - (1 - press.scale) * pressed.value) },
      { translateY: press.translateY * pressed.value },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, press.config);
      }}
      hitSlop={hitSlopFor(BAR_HEIGHT)}
      accessibilityRole="tab"
      accessibilityLabel={labelText}
      accessibilityState={{ selected: focused }}
      style={styles.item}
    >
      <Animated.View style={contentStyle}>
        <Glyph
          size={ICON_SIZE}
          color={focused ? marmalade[600] : chrome.textMuted}
          weight={focused ? 'fill' : 'regular'}
        />
        {badgeCount ? (
          <View style={styles.badge}>
            <Text style={[text.statSm, styles.badgeText]}>
              {badgeCount > 9 ? '9+' : String(badgeCount)}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  assembly: {
    position: 'absolute',
    alignItems: 'center',
    // Room above the pill for the part of the shutter that sticks out.
    paddingTop: FAB_RISE,
  },
  /**
   * Centred by half-width offset rather than by `alignSelf`. The assembly's width comes
   * from `left`/`right` insets and is not known until layout, and `alignSelf` on an
   * absolutely-positioned child is not reliable across platforms — this is exact.
   */
  shutterHit: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -FAB_SIZE / 2,
  },
  shutter: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radii.full,
    backgroundColor: marmalade[600],
    // The ring is what makes the disc read as punching through the pill. Against the page
    // it is a highlight; against the black bar it is a cut-out.
    borderWidth: 4,
    borderColor: paper.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    alignSelf: 'stretch',
    height: BAR_HEIGHT,
    borderRadius: radii.full,
    backgroundColor: chrome.fill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  fabSlot: {
    width: FAB_SLOT,
  },
  item: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -8,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: radii.xs,
    backgroundColor: marmalade[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: chrome.text,
    fontSize: 9,
    lineHeight: 11,
  },
});
