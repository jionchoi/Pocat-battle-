import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Crosshair, Images, type IconProps } from 'phosphor-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { InlineError, EmptyState } from '../../components/EmptyState';
import { useStatusBarStyle } from '../../components/Screen';
import { SelfMarker, SightingPin } from '../../components/MapPin';
import type { MapStackParamList, MainTabParamList } from '../../navigation/types';
import { MAP_CONFIG } from '../../constants/game';
import {
  paper,
  elevation,
  marmalade,
  icon,
  innerHighlight,
  layout,
  press,
  radii,
  spacing,
  text,
  useReduceMotion,
} from '../../theme';
import { distanceBetween } from '../../utils/format';
import { regionToViewport } from '../../services/location';
import { useLocation } from '../../hooks/useLocation';
import { useMapStore } from '../../store/mapStore';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../api/endpoints';
import { SightingStories } from '../../components/SightingStories';
import { clusterSightings, type SightingCluster } from '../../lib/sightingClusters';

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
  /** The pin that is open, with everything behind it. Null when the map is bare. */
  const [preview, setPreview] = useState<SightingCluster | null>(null);

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
   * Record a coarse home area, for the neighbourhood leaderboard and for suppressing capture
   * pins near where the player lives. The server snaps it to a ~1km cell before storing.
   *
   * Sent **once per session**, and the guard is what makes that true. `position` changes with
   * every GPS fix, so an effect depending on it re-sent on every update and each one overwrote
   * the last — which quietly turned a home area into a record of wherever the player currently
   * was. The comment here claimed "once" long before anything enforced it.
   */
  const homeSent = useRef(false);

  useEffect(() => {
    if (!position || !user || homeSent.current) return;

    homeSent.current = true;
    authApi.setHomeLocation({ lat: position.lat, lng: position.lng }).catch(() => undefined);
  }, [position, user]);

  /*
   * Refetch whenever the map is looked at again.
   *
   * Sightings only ever arrived through `onRegionChangeComplete`, which fires when the camera
   * moves — so a photo shared to the map from the capture flow did not appear when the player
   * landed back here. It appeared the moment they panned, which is why it looked like the map
   * needed to be tapped before it would tell the truth.
   *
   * `retry` refetches `lastViewport`, which is the store's record of the region the map is
   * actually showing, so this asks for exactly what is on screen rather than guessing a
   * viewport. It no-ops before the first region settles, and the fetch behind it is debounced
   * and aborts its predecessor, so a fast tab-switch cannot stack requests.
   */
  useFocusEffect(
    useCallback(() => {
      retry();
    }, [retry])
  );

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

  /*
   * Grouped after the layer filter, never before.
   *
   * Switching to "My photos" has to re-cluster rather than hide members of groups built from
   * everybody's captures — otherwise a pin would keep the count and the position it got from
   * photographs that are no longer being shown, and open a stack with other people's cats in it.
   */
  const clusters = useMemo(
    () => clusterSightings(visibleSightings, MAP_CONFIG.clusterRadiusM),
    [visibleSightings]
  );

  const empty = visibleSightings.length === 0;

  /**
   * The floating controls sit just above the tab bar, measured from the bar itself.
   *
   * `tabBarClearance` is the wrong ruler for them: it is generous on purpose, because it
   * has to clear the shutter breaking out of the pill's top edge for a *scrolling* list.
   * These controls are in the right-hand corner where the shutter never reaches, so
   * clearing the pill and a gap is the whole requirement — and measuring from the bar
   * keeps them in the same place on a device with no home indicator.
   */
  const controlsBottom =
    insets.bottom + layout.tabBarLift + layout.tabBarHeight + spacing.md;

  /**
   * How far the open sighting is from the player.
   *
   * The one fact on the card that decides anything — a cat 90m away is worth walking to
   * and the same cat 4km away is not. Null until there is a fix, which is a real state on
   * a cold start rather than an error.
   */
  const previewDistance = useMemo(
    () => (preview && position ? distanceBetween(position, preview.location) : null),
    [position, preview]
  );

  /*
   * Dark glyphs in the notch. This screen is a light map with a white sheet over it, and it
   * does not render `Screen` — so before this it simply inherited whatever the last surface
   * set, which after a trip to the camera was white-on-white. Both branches below are paper.
   */
  useStatusBarStyle('dark');

  if (permission === 'denied') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState
          title="Location is switched off"
          body="Cat Frame needs location to show cat sightings near you, and to score the photos you take. You can turn it back on in your device settings."
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

        {clusters.map((cluster) => (
          <Marker
            /*
             * Keyed on the count as well as the representative.
             *
             * `tracksViewChanges={false}` rasterises a marker once and never looks at it again,
             * which is what keeps a pan from re-rendering every pin on every frame — but it also
             * means a badge that changed would keep drawing the old number. The id alone is not
             * enough: deleting a photograph from the middle of a group leaves the newest one in
             * place, so the id survives while the count drops. Folding the count into the key
             * remounts the marker exactly when the thing it has frozen is wrong.
             */
            key={`${cluster.id}:${cluster.sightings.length}`}
            coordinate={{ latitude: cluster.location.lat, longitude: cluster.location.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            {/*
              A pin shows the photographs that were taken there. It used to open the camera,
              which answered a question nobody asked: a pin is a record of a cat somebody
              already found, and the shutter for finding your own is permanently on screen
              in the middle of the tab bar.
            */}
            <SightingPin
              verified={cluster.verified}
              isMine={cluster.hasMine}
              count={cluster.sightings.length}
              onPress={() => setPreview(cluster)}
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
            <Text style={[text.bodySm, { color: paper.textMuted }]}>
              {layer === 'mine'
                ? 'None of your photos were taken around here yet.'
                : 'No sightings nearby. Log the first one.'}
            </Text>
          </View>
        </View>
      ) : null}

      {/*
        Recentre, and one door out.

        The capture shutter used to sit here too, but it is now the centre of the tab bar —
        permanently on screen, a few points below this spot, in the same colour. Two coral
        camera buttons within 60pt of each other read as two different actions, and the
        player has to work out which.

        The second control is the *photographs* behind whichever layer is switched on.
        Community and Friends used to be two separate buttons here, which duplicated a
        choice the toggle at the top of the screen was already making — the map was asking
        "whose cats?" twice. One button that follows the toggle asks it once: on Community
        it opens the community feed, on My photos it opens your album.
      */}
      {preview ? (
        /* The stack owns the bottom of the screen while it is open — the controls step
           aside rather than stacking two floating objects in the same corner. */
        <SightingStories
          sightings={preview.sightings}
          distance={previewDistance}
          onDismiss={() => setPreview(null)}
        />
      ) : (
        <View style={[styles.controls, { bottom: controlsBottom }]}>
          <RoundControl
            label="Centre on me"
            onPress={recentre}
            Glyph={Crosshair}
            variant="secondary"
          />
          {/*
            One album glyph for both states. The icon names what is behind the button —
            photographs — and the layer decides whose: on Community it opens the feed, on
            My photos it opens your own album. A second glyph for the same noun would be
            the map asking "whose cats?" twice, which is the question the toggle owns.
          */}
          <RoundControl
            label={layer === 'mine' ? 'Open my album' : 'Open the community feed'}
            onPress={() =>
              layer === 'mine'
                ? navigation.navigate('PhotoAlbumGrid')
                : navigation.navigate('CommunityFeed')
            }
            Glyph={Images}
            variant="secondary"
          />
        </View>
      )}
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
    <View style={[styles.toggle, innerHighlight(paper.innerHighlight)]}>
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
              active && { backgroundColor: marmalade[100] },
            ]}
          >
            <Text
              style={[
                text.bodySm,
                { color: active ? marmalade[700] : paper.textMuted },
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
  Glyph: React.ComponentType<IconProps>;
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
            backgroundColor: primary ? marmalade[600] : paper.surface,
            borderColor: primary ? marmalade[700] : paper.hairlineHi,
          },
          elevation('floating', 'paper'),
          animated,
        ]}
      >
        <Glyph
          size={primary ? 26 : 20}
          color={primary ? '#FFFFFF' : paper.text}
          weight={primary ? icon.weightActive : icon.weightDefault}
        />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: paper.bg,
  },
  topBar: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
    alignItems: 'center',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: paper.surface,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: paper.hairline,
    padding: 3,
    gap: 2,
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
    backgroundColor: paper.surface,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: paper.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
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
