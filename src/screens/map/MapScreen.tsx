import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  Clock,
  Crosshair,
  Images,
  Lock,
  SealCheck,
  X,
  type IconProps,
} from 'phosphor-react-native';
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
import { MAP_CONFIG, tierFor } from '../../constants/game';
import {
  paper,
  chrome,
  elevation,
  hitSlopFor,
  marmalade,
  icon,
  innerHighlight,
  layout,
  photoScrim,
  press,
  radii,
  rarity,
  sage,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../../theme';
import { distanceBetween, distanceLabel, relativeTime } from '../../utils/format';
import { regionToViewport } from '../../services/location';
import { useLocation } from '../../hooks/useLocation';
import { useMapStore } from '../../store/mapStore';
import { useAuthStore } from '../../store/authStore';
import { authApi, type MapSighting } from '../../api/endpoints';

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
  const [preview, setPreview] = useState<MapSighting | null>(null);

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
            {/*
              A pin shows the photograph that was taken there. It used to open the camera,
              which answered a question nobody asked: a pin is a record of a cat somebody
              already found, and the shutter for finding your own is permanently on screen
              in the middle of the tab bar.
            */}
            <SightingPin
              verified={sighting.verified}
              isMine={sighting.isMine}
              onPress={() => setPreview(sighting)}
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
        /* The preview owns the bottom of the screen while it is open — the controls step
           aside rather than stacking two floating objects in the same corner. */
        <SightingPreview
          sighting={preview}
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

/**
 * A sighting, opened from its pin.
 *
 * Nearly the whole screen. A small card floating over a map asks the reader to look at a
 * photograph through a letterbox while the thing it is covering carries on competing for
 * attention behind it; at this size the photograph is simply what you are looking at, and
 * the map waits. The backdrop dims and takes a tap, so the way out is anywhere.
 *
 * The details sit in the bottom-left corner, over the image rather than under it. Distance
 * leads, at heading size, because it is the one fact that decides anything — whether this
 * cat is worth walking to. Trust is the eyebrow above it, age the line below.
 *
 * Nothing to press but close. This briefly carried a "Photograph one here" button, which
 * was wrong twice over: the coral shutter is permanently on screen below it, and capture
 * reads the device's live position rather than the pin's, so "here" named a place the
 * camera would not have gone. A pin answers "what is at that spot", and that is all.
 */
const SightingPreview = React.memo(function SightingPreview({
  sighting,
  distance,
  onDismiss,
}: {
  sighting: MapSighting;
  /** Metres from the player, when there is a fix. */
  distance: number | null;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = reduceMotion ? 1 : withSpring(1, spring.soft);
  }, [enter, reduceMotion]);

  const backdrop = useAnimatedStyle(() => ({ opacity: enter.value }));

  const card = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 24 }],
  }));

  const age = relativeTime(sighting.createdAt);

  /**
   * The server sends the photo's stored tier. Deriving it from the score as a fallback
   * keeps the line honest for rows written before sightings carried a photo link, where
   * the score can arrive without one.
   */
  const tier = sighting.tier ?? (sighting.score !== null ? tierFor(sighting.score) : null);

  const byline = sighting.isMine
    ? 'by you'
    : sighting.reporter
      ? `by ${sighting.reporter.username}`
      : 'reported';

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close this sighting"
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.preview,
          {
            top: insets.top + spacing.xs,
            bottom: layout.tabBarClearance + spacing.md,
          },
          elevation('floating', 'paper'),
          card,
        ]}
      >
        <Image
          source={sighting.photoUrl || undefined}
          contentFit="cover"
          transition={220}
          style={StyleSheet.absoluteFill}
          accessibilityLabel="A cat photographed here"
        />

        {/* Two stacked washes rather than one flat panel — same construction as the feed's
            poster cards, so text on a photograph is legible the same way everywhere. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[styles.scrimUpper, { backgroundColor: photoScrim.posterTop }]} />
          <View style={[styles.scrimLower, { backgroundColor: photoScrim.posterBottom }]} />
        </View>

        <Pressable
          onPress={onDismiss}
          hitSlop={hitSlopFor(44)}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.previewClose, innerHighlight(paper.innerHighlight)]}
        >
          <X size={15} weight="bold" color={paper.text} />
        </Pressable>

        <View style={styles.previewFoot}>
          <View style={styles.previewMark}>
            {sighting.verified ? (
              <SealCheck size={13} weight="fill" color={sage[100]} />
            ) : (
              <Clock size={13} weight="bold" color={chrome.text} />
            )}
            <Text style={[text.eyebrow, styles.previewEyebrow]}>
              {sighting.verified ? 'Verified sighting' : 'Single report'}
            </Text>
          </View>

          <Text style={[text.h1, styles.onPhoto]} numberOfLines={1}>
            {distance === null ? `Seen ${age}` : `${distanceLabel(distance)} away`}
          </Text>

          {/*
            What the photograph scored, small. The tier is spelled out rather than left to
            the dot beside it — tier is never carried by colour alone anywhere in this
            product, and a coloured pip on a photograph is the least reliable place to try.
          */}
          <View style={styles.previewScore}>
            {sighting.score !== null ? (
              <>
                <Text style={[text.statSm, styles.onPhoto]}>{sighting.score}</Text>
                {tier ? (
                  <>
                    <View
                      style={[styles.tierDot, { backgroundColor: rarity[tier].base }]}
                    />
                    <Text style={[text.caption, styles.previewMeta]}>{tier}</Text>
                  </>
                ) : null}
              </>
            ) : (
              <LockedScore />
            )}
          </View>

          <Text style={[text.caption, styles.previewBy]} numberOfLines={1}>
            {byline} · {age}
          </Text>
        </View>
      </Animated.View>
    </>
  );
});

/**
 * A score that is not on offer.
 *
 * Blurred digits with a padlock over them rather than a dash or an absence: an empty slot
 * reads as a rendering bug, while a number you can see the shape of but not the value of
 * reads as something being withheld — which is the honest description of a pin whose
 * capture the map cannot reach.
 *
 * The blur is a text shadow with no offset and a transparent fill, so the glyphs are
 * genuinely unreadable rather than merely small. There is no image to blur behind it and
 * no platform blur view involved, which also means it behaves identically on both.
 *
 * The digits are deliberately meaningless. Rendering a plausible score at low opacity
 * would be inventing a number for a photograph nobody can produce.
 */
const LockedScore = React.memo(function LockedScore() {
  return (
    <>
      <View style={styles.lockedScore}>
        <Text style={[text.statSm, styles.lockedDigits]} accessible={false}>
          88
        </Text>
        <View style={styles.lockedBadge} pointerEvents="none">
          <Lock size={11} weight="fill" color={chrome.text} />
        </View>
      </View>
      <Text style={[text.caption, styles.previewMeta]}>Score locked</Text>
    </>
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
  backdrop: {
    backgroundColor: paper.scrim,
  },
  preview: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
    borderRadius: radii.xxl,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  /** Bottom-anchored, like the poster cards in the feed. */
  scrimUpper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
  },
  scrimLower: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '30%',
  },
  previewClose: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 30,
    height: 30,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: paper.surface,
  },
  previewFoot: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    alignItems: 'flex-start',
    gap: 5,
  },
  previewMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  previewEyebrow: {
    color: chrome.text,
  },
  onPhoto: {
    color: chrome.text,
  },
  previewMeta: {
    color: 'rgba(255, 255, 255, 0.76)',
  },
  previewScore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  lockedScore: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Transparent fill plus a zero-offset shadow: the glyphs render only as their own
   * halo, which is a real blur rather than reduced opacity.
   */
  lockedDigits: {
    color: 'transparent',
    textShadowColor: 'rgba(255, 255, 255, 0.62)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },
  lockedBadge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierDot: {
    width: 6,
    height: 6,
    borderRadius: radii.full,
  },
  previewBy: {
    color: 'rgba(255, 255, 255, 0.6)',
  },
  control: {
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
