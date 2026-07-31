import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Crosshair } from 'phosphor-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { InlineError, EmptyState } from '../../components/EmptyState';
import { SelfMarker, SightingPin } from '../../components/MapPin';
import type { MapStackParamList, MainTabParamList } from '../../navigation/types';
import { MAP_CONFIG } from '../../constants/game';
import {
  bone,
  elevation,
  fern,
  icon,
  innerHighlight,
  layout,
  press,
  radii,
  spacing,
  text,
  useReduceMotion,
} from '../../theme';
import { regionToViewport } from '../../services/location';
import { useLocation } from '../../hooks/useLocation';
import { useMapStore } from '../../store/mapStore';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../api/endpoints';

/**
 * The landing screen (README section 5.2).
 *
 * Sightings are fetched by bounding box as the region changes — never a whole city at
 * once. The store handles debounce and request cancellation; this screen just reports
 * the viewport.
 */

type Props = CompositeScreenProps<
  NativeStackScreenProps<MapStackParamList, 'Map'>,
  BottomTabScreenProps<MainTabParamList>
>;

const FALLBACK_REGION: Region = {
  // Central London, matching the seeded development sightings.
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: MAP_CONFIG.defaultZoomDelta,
  longitudeDelta: MAP_CONFIG.defaultZoomDelta,
};

export function MapScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const { permission, position, request } = useLocation({ watch: true });

  const sightings = useMapStore((s) => s.sightings);
  const layer = useMapStore((s) => s.layer);
  const error = useMapStore((s) => s.error);
  const setLayer = useMapStore((s) => s.setLayer);
  const fetchViewport = useMapStore((s) => s.fetchViewport);
  const retry = useMapStore((s) => s.retry);

  const user = useAuthStore((s) => s.user);
  const [centred, setCentred] = useState(false);

  const region = useMemo<Region>(() => {
    if (!position) return FALLBACK_REGION;
    return {
      latitude: position.lat,
      longitude: position.lng,
      latitudeDelta: MAP_CONFIG.defaultZoomDelta,
      longitudeDelta: MAP_CONFIG.defaultZoomDelta,
    };
  }, [position]);

  // Recentre once when the first fix arrives, then leave the camera alone — stealing it
  // back on every GPS update makes the map impossible to pan.
  useEffect(() => {
    if (!position || centred) return;
    mapRef.current?.animateToRegion(region, 600);
    setCentred(true);
  }, [centred, position, region]);

  /**
   * Record a coarse home area once, for the neighbourhood leaderboard. The server rounds
   * it to a ~1km cell; this is not a location history.
   */
  useEffect(() => {
    if (!position || !user) return;
    authApi.setHomeLocation({ lat: position.lat, lng: position.lng }).catch(() => undefined);
  }, [position, user]);

  const onRegionChangeComplete = useCallback(
    (next: Region) => {
      fetchViewport(regionToViewport(next));
    },
    [fetchViewport]
  );

  const recentre = useCallback(() => {
    if (!position) {
      void request();
      return;
    }
    mapRef.current?.animateToRegion(region, 400);
  }, [position, region, request]);

  const visibleSightings = useMemo(
    () => (layer === 'mine' ? sightings.filter((s) => s.isMine) : sightings),
    [layer, sightings]
  );

  const empty = visibleSightings.length === 0;

  if (permission === 'denied') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState
          title="Location is switched off"
          body="CatSnap needs location to show cat sightings near you, and to score the photos you take. You can turn it back on in your device settings."
          Glyph={Crosshair}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
      >
        {position ? (
          <Marker
            coordinate={{ latitude: position.lat, longitude: position.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            // Static marker for the player's own dot; the breathing animation lives inside.
            tracksViewChanges={false}
          >
            <SelfMarker />
          </Marker>
        ) : null}

        {visibleSightings.map((sighting) => (
          <Marker
            key={sighting.id}
            coordinate={{ latitude: sighting.location.lat, longitude: sighting.location.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <SightingPin
              verified={sighting.verified}
              isMine={sighting.isMine}
              onPress={() => navigation.navigate('Capture')}
            />
          </Marker>
        ))}
      </MapView>

      {/* Floating glass layer toggle. Detached from the top edge, never glued to it. */}
      <View style={[styles.topBar, { top: insets.top + spacing.xs }]}>
        <LayerToggle layer={layer} onChange={setLayer} />
      </View>

      {error ? (
        <View style={[styles.errorSlot, { top: insets.top + 64 }]}>
          <InlineError message={error} onRetry={retry} />
        </View>
      ) : null}

      {/* Empty state sits over the map rather than replacing it — the map is still
          useful for walking around even with no pins on it yet. */}
      {empty && !error ? (
        <View style={[styles.emptySlot, { top: insets.top + 64 }]} pointerEvents="none">
          <View style={styles.emptyCard}>
            <Text style={[text.bodySm, { color: bone.textMuted }]}>
              {layer === 'mine'
                ? 'None of your photos were taken around here yet.'
                : 'No sightings nearby. Log the first one.'}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={[styles.controls, { bottom: layout.tabBarClearance + spacing.md }]}>
        <RoundControl
          label="Centre on me"
          onPress={recentre}
          Glyph={Crosshair}
          variant="secondary"
        />
        <RoundControl
          label="Open the camera to photograph a cat"
          onPress={() => navigation.navigate('Capture')}
          Glyph={Camera}
          variant="primary"
        />
      </View>
    </View>
  );
}

const LayerToggle = React.memo(function LayerToggle({
  layer,
  onChange,
}: {
  layer: 'mine' | 'community';
  onChange: (layer: 'mine' | 'community') => void;
}) {
  const options: { key: 'community' | 'mine'; label: string }[] = [
    { key: 'community', label: 'Community' },
    { key: 'mine', label: 'My photos' },
  ];

  return (
    <View style={[styles.toggle, innerHighlight(bone.innerHighlight)]}>
      {options.map((option) => {
        const active = option.key === layer;

        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              styles.toggleItem,
              active && { backgroundColor: fern[100] },
            ]}
          >
            <Text
              style={[
                text.bodySm,
                { color: active ? fern[700] : bone.textMuted },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const RoundControl = React.memo(function RoundControl({
  label,
  onPress,
  Glyph,
  variant,
}: {
  label: string;
  onPress: () => void;
  Glyph: typeof Camera;
  variant: 'primary' | 'secondary';
}) {
  const pressed = useSharedValue(0);
  const reduceMotion = useReduceMotion();

  const animated = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - (1 - press.scale) * pressed.value },
      { translateY: press.translateY * pressed.value },
    ],
  }));

  const primary = variant === 'primary';

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
      accessibilityLabel={label}
    >
      <Animated.View
        style={[
          styles.control,
          {
            width: primary ? 64 : 48,
            height: primary ? 64 : 48,
            backgroundColor: primary ? fern[600] : bone.surface,
            borderColor: primary ? fern[700] : bone.hairlineHi,
          },
          elevation('floating', 'bone'),
          animated,
        ]}
      >
        <Glyph
          size={primary ? 26 : 20}
          color={primary ? '#FFFFFF' : bone.text}
          weight={primary ? icon.weightActive : icon.weightDefault}
        />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: bone.bg,
  },
  topBar: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
    alignItems: 'center',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: bone.surface,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: bone.hairline,
    padding: 3,
    gap: 2,
    ...elevation('raised', 'bone'),
  },
  toggleItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    minHeight: 34,
    justifyContent: 'center',
  },
  errorSlot: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
  },
  emptySlot: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: bone.surface,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: bone.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...elevation('raised', 'bone'),
  },
  controls: {
    position: 'absolute',
    right: layout.gutter,
    alignItems: 'center',
    gap: spacing.sm,
  },
  control: {
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
