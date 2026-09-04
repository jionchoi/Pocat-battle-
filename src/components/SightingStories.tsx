import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Clock, Lock, SealCheck, X } from 'phosphor-react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { MapSighting } from '../api/endpoints';
import { MAP_CONFIG, tierFor } from '../constants/game';
import { distanceLabel, relativeTime } from '../utils/format';
import {
  paper,
  chrome,
  elevation,
  hitSlopFor,
  innerHighlight,
  layout,
  photoScrim,
  radii,
  rarity,
  sage,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../theme';

/**
 * The photographs behind one pin.
 *
 * A pin is a place, and a place usually has more than one photograph — the same doorway, the
 * same wall, over days. This is what opens when you tap it: the newest first, then the rest,
 * advancing on their own, with a bar per photograph across the top so you can see how many
 * there are before deciding to stay.
 *
 * ## One component for one photo and for twelve
 *
 * A single sighting renders with no bars, no timer and no tap zones — exactly the still card
 * this replaced, because a pin with one photograph behind it has nothing to advance to and a
 * lone bar draining itself would be a countdown to nothing. Everything below that is
 * conditional on there being more than one. The alternative was two components drawing the same
 * photograph two ways, which is two places for the scrim and the score line to drift apart.
 *
 * ## Nearly the whole screen, still
 *
 * A small card floating over a map asks the reader to look at a photograph through a letterbox
 * while the thing it is covering carries on competing for attention behind it. At this size the
 * photograph is simply what you are looking at, and the map waits. The backdrop dims and takes a
 * tap, so the way out is anywhere.
 */

/** Left third goes back, the rest goes forward — the proportion every story UI uses. */
const BACK_ZONE = 0.32;

export const SightingStories = React.memo(function SightingStories({
  sightings,
  distance,
  onDismiss,
}: {
  /** Newest first. One or many; the component is the same either way. */
  sightings: MapSighting[];
  /**
   * Metres from the player to the pin, when there is a fix.
   *
   * One value for the whole stack rather than per photograph: everything in it is within
   * `clusterRadiusM` of the pin, so a per-slide distance would be re-rendering the same number
   * with noise on the end of it.
   */
  distance: number | null;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const [index, setIndex] = useState(0);
  const count = sightings.length;
  const many = count > 1;

  /*
   * Clamped, though nothing should currently be able to make it necessary: the stack is a
   * snapshot taken when the pin was tapped, so a viewport refetch behind the open card cannot
   * shorten it. That is the intended behaviour rather than an oversight — a photograph
   * disappearing from under somebody mid-look is worse than briefly showing one that has just
   * been un-shared. The clamp costs one comparison and means a future change to that decision
   * cannot render `undefined`.
   */
  const safeIndex = Math.min(index, count - 1);
  const sighting = sightings[safeIndex]!;

  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = reduceMotion ? 1 : withSpring(1, spring.soft);
  }, [enter, reduceMotion]);

  const backdrop = useAnimatedStyle(() => ({ opacity: enter.value }));
  const card = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 24 }],
  }));

  /* ---------------------------------------------------------------------- */
  /* Advancing                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * The bar's fill, and only the bar's fill.
   *
   * Timing lives in the timeout below rather than in this animation's completion callback. They
   * are separable and keeping them separate is what lets reduce-motion turn the animation off
   * without also turning off advancing — the player asked for less movement, not for the stack
   * to stop.
   */
  const progress = useSharedValue(0);

  /**
   * What is left of this slide, so a pause can resume rather than restart.
   *
   * Typed rather than inferred: `MAP_CONFIG` is `as const`, so the initialiser would narrow this
   * ref to the literal 5000 and nothing else could ever be written to it.
   */
  const remaining = useRef<number>(MAP_CONFIG.storySlideMs);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [paused, setPaused] = useState(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const advance = useCallback(() => {
    setIndex((current) => {
      // Holds on the last one rather than closing itself. Instagram exits to the next person's
      // story; there is nobody next here, and a card that vanished on its own would look like
      // the app dismissing something the player was still reading.
      if (current >= count - 1) return current;
      return current + 1;
    });
  }, [count]);

  const run = useCallback(() => {
    if (!many) return;

    startedAt.current = Date.now();

    /*
     * Linear, which is the one place this codebase's no-linear-easing rule does not apply.
     * A progress bar is a readout of time remaining; any expressive curve makes it lie about
     * how long is left, which is the only thing it is for.
     */
    if (!reduceMotion) {
      progress.value = withTiming(1, {
        duration: remaining.current,
        easing: Easing.linear,
      });
    }

    timer.current = setTimeout(advance, remaining.current);
  }, [advance, many, progress, reduceMotion]);

  const pause = useCallback(() => {
    if (!many || paused) return;

    clearTimer();
    cancelAnimation(progress);
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    setPaused(true);
  }, [clearTimer, many, paused, progress]);

  const resume = useCallback(() => {
    if (!many || !paused) return;

    setPaused(false);
    run();
  }, [many, paused, run]);

  // Restarts whenever the slide changes. `safeIndex` rather than `index` so a stack that shrank
  // out from under us restarts on the slide actually being shown.
  useEffect(() => {
    remaining.current = MAP_CONFIG.storySlideMs;
    progress.value = 0;
    setPaused(false);
    run();

    return () => {
      clearTimer();
      cancelAnimation(progress);
    };
  }, [clearTimer, progress, run, safeIndex]);

  /*
   * The next photograph is fetched while this one is being looked at.
   *
   * Without it every advance is a blank card for as long as the network takes, which on a stack
   * of eight is most of what the feature is. Prefetch is fire-and-forget and a failure is
   * invisible — the image simply loads when it is shown, which is what would have happened.
   */
  useEffect(() => {
    const next = sightings[safeIndex + 1];
    if (next?.photoUrl) void Image.prefetch(next.photoUrl).catch(() => undefined);
  }, [safeIndex, sightings]);

  const goTo = useCallback(
    (target: number) => {
      if (target < 0) return;
      if (target > count - 1) return;
      setIndex(target);
    },
    [count]
  );

  /* ---------------------------------------------------------------------- */
  /* The slide                                                              */
  /* ---------------------------------------------------------------------- */

  const age = relativeTime(sighting.createdAt);

  /**
   * The server sends the photo's stored tier. Deriving it from the score as a fallback keeps the
   * line honest for rows written before sightings carried a photo link, where the score can
   * arrive without one.
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
          styles.card,
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
        {/*
          The same ramp the poster cards use, and for the same reason it was rebuilt there:
          two bottom-anchored blocks of flat colour drew a black box over the lower half of
          the photograph rather than a fall-off. See `Scrim` in `ViralCard`.
        */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0, 0, 0, 0)', photoScrim.posterTop, photoScrim.posterBottom]}
          locations={[0.45, 0.72, 1]}
          style={StyleSheet.absoluteFill}
        />

        {many ? (
          <>
            {/*
              The tap zones sit under the chrome and over the photograph, so the close button
              and the bars keep their own hits. Long press holds the slide — the standard
              gesture, and the only way to actually finish reading a caption on a timer.
            */}
            <View style={StyleSheet.absoluteFill}>
              <View style={styles.zones}>
                <Pressable
                  style={styles.zoneBack}
                  onPress={() => goTo(safeIndex - 1)}
                  onLongPress={pause}
                  onPressOut={resume}
                  delayLongPress={220}
                  accessibilityRole="button"
                  accessibilityLabel="Previous photo"
                />
                <Pressable
                  style={styles.zoneNext}
                  onPress={() => goTo(safeIndex + 1)}
                  onLongPress={pause}
                  onPressOut={resume}
                  delayLongPress={220}
                  accessibilityRole="button"
                  accessibilityLabel="Next photo"
                />
              </View>
            </View>

            <View
              style={[styles.bars, { top: spacing.sm }]}
              pointerEvents="none"
              accessibilityRole="progressbar"
              accessibilityLabel={`Photo ${safeIndex + 1} of ${count}`}
            >
              {sightings.map((s, i) => (
                <StoryBar
                  key={s.id}
                  state={i < safeIndex ? 'done' : i === safeIndex ? 'active' : 'todo'}
                  progress={progress}
                  reduceMotion={reduceMotion}
                />
              ))}
            </View>
          </>
        ) : null}

        <Pressable
          onPress={onDismiss}
          hitSlop={hitSlopFor(44)}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[
            styles.close,
            { top: many ? spacing.sm + BAR_HEIGHT + spacing.xs : spacing.sm },
            innerHighlight(paper.innerHighlight),
          ]}
        >
          <X size={15} weight="bold" color={paper.text} />
        </Pressable>

        <View style={styles.foot} pointerEvents="none">
          <View style={styles.mark}>
            {sighting.verified ? (
              <SealCheck size={13} weight="fill" color={sage[100]} />
            ) : (
              <Clock size={13} weight="bold" color={chrome.text} />
            )}
            <Text style={[text.eyebrow, styles.eyebrow]}>
              {/*
                Not "Verified". Nobody verified anything — the flag is set from whether there
                is a photograph behind the pin, and calling that "verified" implied a review
                that does not exist anywhere in the product. See the note in `MapPin`.
              */}
              {sighting.verified ? 'Photographed here' : 'Reported, no photo'}
            </Text>
            {many ? (
              <Text style={[text.eyebrow, styles.counter]}>
                · {safeIndex + 1}/{count}
              </Text>
            ) : null}
          </View>

          <Text style={[text.h1, styles.onPhoto]} numberOfLines={1}>
            {distance === null ? `Seen ${age}` : `${distanceLabel(distance)} away`}
          </Text>

          {/*
            What the photograph scored, small. The tier is spelled out rather than left to the
            dot beside it — tier is never carried by colour alone anywhere in this product, and
            a coloured pip on a photograph is the least reliable place to try.
          */}
          <View style={styles.score}>
            {sighting.score !== null ? (
              <>
                <Text style={[text.statSm, styles.onPhoto]}>{sighting.score}</Text>
                {tier ? (
                  <>
                    <View style={[styles.tierDot, { backgroundColor: rarity[tier].base }]} />
                    <Text style={[text.caption, styles.meta]}>{tier}</Text>
                  </>
                ) : null}
              </>
            ) : (
              <LockedScore />
            )}
          </View>

          <Text style={[text.caption, styles.by]} numberOfLines={1}>
            {byline} · {age}
          </Text>
        </View>
      </Animated.View>
    </>
  );
});

const BAR_HEIGHT = 3;

/**
 * One segment of the header.
 *
 * `scaleX` from a left origin rather than an animated `width` — the motion rules in
 * `theme/motion.ts` are a hard constraint and for good reason: `width` triggers layout on the
 * whole row every frame, and this row can hold a dozen of these.
 *
 * Under reduce-motion the active bar sits at full rather than draining. The slide still
 * advances on its own; what is removed is the moving part, which is the thing that was asked
 * for. A bar that jumped in steps would be motion with extra stutter.
 */
const StoryBar = React.memo(function StoryBar({
  state,
  progress,
  reduceMotion,
}: {
  state: 'done' | 'active' | 'todo';
  progress: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const fill = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX:
          state === 'done' ? 1 : state === 'todo' ? 0 : reduceMotion ? 1 : progress.value,
      },
    ],
  }));

  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, fill]} />
    </View>
  );
});

/**
 * A score that is not on offer.
 *
 * Blurred digits with a padlock over them rather than a dash or an absence: an empty slot reads
 * as a rendering bug, while a number you can see the shape of but not the value of reads as
 * something being withheld — which is the honest description of a pin whose capture the map
 * cannot reach.
 *
 * The blur is a text shadow with no offset and a transparent fill, so the glyphs are genuinely
 * unreadable rather than merely small. There is no image to blur behind it and no platform blur
 * view involved, which also means it behaves identically on both.
 *
 * The digits are deliberately meaningless. Rendering a plausible score at low opacity would be
 * inventing a number for a photograph nobody can produce.
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
      <Text style={[text.caption, styles.meta]}>Score locked</Text>
    </>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: paper.scrim,
  },
  card: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
    borderRadius: radii.xxl,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  zones: {
    flex: 1,
    flexDirection: 'row',
  },
  zoneBack: {
    flex: BACK_ZONE,
  },
  zoneNext: {
    flex: 1 - BACK_ZONE,
  },
  bars: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: 3,
    height: BAR_HEIGHT,
  },
  barTrack: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  barFill: {
    width: '100%',
    height: '100%',
    borderRadius: BAR_HEIGHT,
    backgroundColor: chrome.text,
    transformOrigin: 'left',
  },
  close: {
    position: 'absolute',
    right: spacing.sm,
    width: 30,
    height: 30,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: paper.surface,
  },
  foot: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    alignItems: 'flex-start',
    gap: 5,
  },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  eyebrow: {
    color: chrome.text,
  },
  counter: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  onPhoto: {
    color: chrome.text,
  },
  meta: {
    color: 'rgba(255, 255, 255, 0.76)',
  },
  score: {
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
   * Transparent fill plus a zero-offset shadow: the glyphs render only as their own halo,
   * which is a real blur rather than reduced opacity.
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
  by: {
    color: 'rgba(255, 255, 255, 0.6)',
  },
});
