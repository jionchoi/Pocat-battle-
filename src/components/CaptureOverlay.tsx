import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'phosphor-react-native';

import type { CapturePhase } from '../store/captureStore';
import {
  CAPTURE_FILTERS,
  SWATCH_SCENE,
  filterById,
  type CaptureFilter,
} from '../constants/filters';
import { CircleButton } from './CircleButton';
import {
  arena,
  chrome,
  hitSlopFor,
  marmalade,
  press,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../theme';

/**
 * CaptureOverlay — the camera's entire UI (README section 6).
 *
 * Arena context throughout: this is a committed immersive screen, so there is no light
 * surface anywhere on it.
 *
 * ## The shutter is at the bottom, and it used to be in the middle
 *
 * It sat dead centre as a 220pt ring with a cat glyph in it, on the theory that the player is
 * already looking there. What that actually did was put the control **on top of the thing it
 * controls** — the ring covered the middle of the frame, which is where you put a cat you are
 * trying to photograph. Framing a shot meant composing around the button.
 *
 * So it is a shutter in the usual place now: bottom centre, thumb-height, out of the frame.
 * The middle of the screen is the viewfinder and nothing is drawn over it.
 *
 * The ring around the old control was once a countdown. A framing window armed itself when an
 * on-device detector had held a cat for enough frames and then fired on its own, and the copy
 * under it taught that mechanic. All of it is gone: the detector, the "holding focus" counter,
 * the countdown and the auto-capture. The phone is not a better judge of the moment than the
 * person holding it. The camera is live, the shutter is always armed, and the only thing that
 * fires it is a finger.
 *
 * ## The shutter *is* the selected filter
 *
 * One row. The looks scroll horizontally and whichever one reaches the middle becomes the
 * shutter — its face is that filter's own preview, so the button shows what pressing it will
 * produce, and choosing a look and taking the photograph happen in the same place.
 *
 * This replaced a rail sitting above a separate button, which put the thing being chosen and
 * the thing being pressed in two different parts of the screen and left the rail reading as
 * decoration that happened to be nearby.
 *
 * The centred swatch stays in the scroll content but is drawn invisible, and the shutter draws
 * it again on top. That keeps the row a plain evenly-strided list — remove the item instead
 * and the content shortens by a slot, moving every snap point after it.
 *
 * The filters are preview-only, and the line under the row says so, because a filter that
 * quietly did not reach the saved file would be the app misrepresenting the photograph it just
 * took. See `constants/filters.ts`.
 */

export interface CaptureOverlayProps {
  phase: CapturePhase;
  onShutter: () => void;
  onClose: () => void;
  /** The selected filter's id. Owned by the screen so it survives the scoring overlay. */
  filterId: string;
  onSelectFilter: (id: string) => void;
}

export const CaptureOverlay = React.memo(function CaptureOverlay({
  phase,
  onShutter,
  onClose,
  filterId,
  onSelectFilter,
}: CaptureOverlayProps) {
  const busy = phase === 'capturing' || phase === 'scoring';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/*
        One control up here, and it is the way out.

        There used to be a share toggle in the opposite corner, set before the shot — which
        asked the player to decide whether a photo was worth publishing before they had
        seen it, or knew what it scored. That decision belongs on the reveal, where the
        photo is in front of them, and it is on the reveal now. Two buttons over a live
        viewfinder for one job was one too many.
      */}
      <View style={styles.top} pointerEvents="box-none">
        <CircleButton
          Glyph={X}
          onPress={onClose}
          accessibilityLabel="Close the camera"
        />
      </View>

      {/*
        The prompt floats above the bottom cluster rather than in the centre of the screen.
        Nothing is drawn over the viewfinder any more — see the note above.
      */}
      <View style={styles.promptRow} pointerEvents="none">
        <PromptCopy phase={phase} />
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        <ShutterRail
          selectedId={filterId}
          onSelect={onSelectFilter}
          onShutter={onShutter}
          disabled={busy}
        />

        {/*
          The name of the look currently loaded into the shutter, and the one line of
          explanation. Out here rather than under each swatch because only one is ever
          selected, and three permanently captioned circles is three labels to read where one
          would do — on a strip that has to stay glanceable over a live preview.
        */}
        <Text style={[text.eyebrow, styles.filterName]} pointerEvents="none">
          {filterById(filterId).label}
        </Text>

        <Text style={styles.disclaimer} pointerEvents="none">
          Preview only — filters don't affect your score
        </Text>
      </View>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* The shutter rail                                                           */
/* -------------------------------------------------------------------------- */

const SHUTTER = 76;
const SHUTTER_RING = 3;
/** The look's face inside the ring, inset far enough that the ring still reads as a ring. */
const SHUTTER_FACE = SHUTTER - SHUTTER_RING * 2 - 8;

/** An unselected look, sitting either side of the shutter. */
const SIDE = 44;

/**
 * How far apart two looks sit.
 *
 * Must exceed `SHUTTER`, or a neighbouring swatch slides under the shutter rather than
 * stopping beside it. The margin above 76 is the air between them.
 */
const ITEM_WIDTH = 92;

const ROW_HEIGHT = 92;

/**
 * The looks, the shutter, and the fact that they are one control.
 *
 * Three ways to change the selection, because a row like this affords all three and a player
 * will try whichever occurs to them: drag it, fling it, or tap a neighbour. All of them land
 * in `commit`, so the selection and the scroll offset can never disagree.
 */
const ShutterRail = React.memo(function ShutterRail({
  selectedId,
  onSelect,
  onShutter,
  disabled,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  onShutter: () => void;
  disabled: boolean;
}) {
  const scroller = useRef<ScrollView | null>(null);
  const { width: windowWidth } = useWindowDimensions();

  /**
   * Half a screen of padding at each end, so the first and last looks can reach the middle.
   *
   * Without it the row can only scroll until the last item meets the right edge — and the one
   * place a look could then never sit is the centre, which is where the shutter is. The first
   * and last filters would be unselectable. `contentInset` says this on iOS alone; padding is
   * the version Android also reads.
   */
  const sidePad = Math.max(0, (windowWidth - ITEM_WIDTH) / 2);

  const index = useMemo(() => {
    const found = CAPTURE_FILTERS.findIndex((f) => f.id === selectedId);
    return found === -1 ? 0 : found;
  }, [selectedId]);

  /*
   * Opens where the screen left off.
   *
   * The row is unmounted while the scoring overlay is up, so this runs again on the way back,
   * and a player returning to the camera should find their look still loaded rather than reset
   * to Natural. Not animated: this is the row's initial position, not a move.
   */
  useEffect(() => {
    scroller.current?.scrollTo({ x: index * ITEM_WIDTH, animated: false });
    // Mount-only on purpose. Reacting to `index` would fight the finger: every selection made
    // by scrolling would scroll the row again underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback(
    (next: number, scroll: boolean) => {
      const filter = CAPTURE_FILTERS[next];
      if (!filter) return;

      if (scroll) scroller.current?.scrollTo({ x: next * ITEM_WIDTH, animated: true });
      if (filter.id !== selectedId) onSelect(filter.id);
    },
    [onSelect, selectedId]
  );

  /**
   * Reads the selection off the resting scroll position.
   *
   * `onMomentumScrollEnd` rather than `onScroll`: re-grading the whole live preview for every
   * slot a fling passes over would repaint the camera several times in one gesture.
   */
  const onSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / ITEM_WIDTH);
      commit(Math.max(0, Math.min(CAPTURE_FILTERS.length - 1, next)), false);
    },
    [commit]
  );

  return (
    <View style={styles.row} pointerEvents="box-none">
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        /* One slot per gesture, so a flick moves one look rather than several. */
        snapToInterval={ITEM_WIDTH}
        disableIntervalMomentum
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        onMomentumScrollEnd={onSettled}
        keyboardShouldPersistTaps="always"
        scrollEnabled={!disabled}
        style={{ opacity: disabled ? 0.4 : 1 }}
      >
        {CAPTURE_FILTERS.map((filter, i) => (
          <Pressable
            key={filter.id}
            onPress={() => commit(i, true)}
            style={styles.slot}
            accessibilityRole="button"
            accessibilityState={{ selected: i === index }}
            accessibilityLabel={`${filter.label} filter`}
            /*
             * The centred one is drawn by the shutter instead. It stays here — invisible and
             * inert — only to hold its place in the stride. See the note at the top.
             */
            pointerEvents={i === index ? 'none' : 'auto'}
          >
            <FilterFace
              filter={filter}
              size={SIDE}
              style={{ opacity: i === index ? 0 : 1 }}
            />
          </Pressable>
        ))}
      </ScrollView>

      {/*
        The shutter, floating over the centre slot.

        `box-none` on the layer so it claims only the button's own footprint — the row either
        side of it stays draggable, which is how the look gets changed.
      */}
      <View style={styles.shutterLayer} pointerEvents="box-none">
        <Shutter
          filter={filterById(selectedId)}
          onPress={onShutter}
          disabled={disabled}
        />
      </View>
    </View>
  );
});

/**
 * One look, drawn as a circle.
 *
 * A *graded* look shows the filter applied to a fixed gradient — see `SWATCH_SCENE` — using the
 * same `color`/`blendMode`/`opacity` the viewfinder uses. That is the point of building it this
 * way rather than picking a colour per filter by hand: the preview is generated *by* the filter,
 * so it cannot drift from what the filter actually does.
 *
 * **Natural is plain white, and is not drawn from the scene at all.** It has no layer, so
 * grading the gradient with it produced the bare gradient — a swatch that looked like *a* look
 * rather than like the absence of one, and a shutter that opened wearing a tan-and-brown face
 * instead of the white ring every camera on the planet has. White says "nothing applied" the
 * way no rendering of a scene can, and it puts the default state of this screen back on the
 * conventional shutter.
 *
 * `isolation: 'isolate'` is required on the graded path, not cosmetic. Without it the blend
 * layer composites against the live camera behind the row instead of against this circle's own
 * gradient, and every swatch turns into a little window onto the viewfinder.
 */
const FilterFace = React.memo(function FilterFace({
  filter,
  size,
  style,
}: {
  filter: CaptureFilter;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  const shape = { width: size, height: size, borderRadius: size / 2 };

  // See above: no layer means no scene either. A flat white disc, and nothing composited.
  if (!filter.layer) {
    return <View style={[styles.face, styles.faceNatural, shape, style]} />;
  }

  return (
    <View style={[styles.face, shape, style]}>
      <LinearGradient
        colors={[...SWATCH_SCENE]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: filter.layer.color,
            mixBlendMode: filter.layer.blendMode,
            opacity: filter.layer.opacity,
          },
        ]}
      />
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Prompt and shutter                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Prompt copy, per phase.
 *
 * Three states, and none of them asks the player to wait for the app. This used to teach the
 * framing window, because the countdown was the mechanic. With the shutter back in the
 * player's hands there is no mechanic to explain, so the resting line says what the camera is
 * for and then gets out of the way.
 */
const PromptCopy = React.memo(function PromptCopy({ phase }: { phase: CapturePhase }) {
  if (phase === 'capturing') {
    return <Text style={[text.h3, styles.promptText]}>Holding still</Text>;
  }

  if (phase === 'scoring') {
    return <Text style={[text.h3, styles.promptText]}>Scoring your shot</Text>;
  }

  return <Text style={[text.bodySm, styles.promptSub]}>Point the camera at a cat</Text>;
});

/**
 * The shutter: the ring every camera has, with the chosen look loaded into its face.
 *
 * Deliberately the plainest thing on the screen apart from what is inside it. No glyph and no
 * label — a control this conventional is understood before it is read, and anything drawn over
 * the face would be covering the one thing the face exists to show.
 *
 * The face scales rather than the whole control, so the ring stays put under the finger. A
 * button whose hit area visibly shrinks as you press it feels like it is escaping.
 */
const Shutter = React.memo(function Shutter({
  filter,
  onPress,
  disabled,
}: {
  filter: CaptureFilter;
  onPress: () => void;
  disabled: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - press.scale) * 0.5 * pressed.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        pressed.value = reduceMotion ? 0 : withSpring(1, spring.snap);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, spring.snap);
      }}
      hitSlop={hitSlopFor(SHUTTER)}
      accessibilityRole="button"
      accessibilityLabel="Take a photo"
      accessibilityHint={`Captures with the ${filter.label} preview`}
      accessibilityState={{ disabled }}
    >
      <View style={[styles.shutterRing, { opacity: disabled ? 0.45 : 1 }]}>
        <Animated.View style={animated}>
          <FilterFace filter={filter} size={SHUTTER_FACE} />
        </Animated.View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: 62,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /* Sits just above the bottom cluster, clear of the viewfinder. */
  promptRow: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 196,
    alignItems: 'center',
  },
  promptText: {
    color: chrome.text,
    textAlign: 'center',
  },
  promptSub: {
    color: arena.textMuted,
    textAlign: 'center',
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 40,
    alignItems: 'center',
  },
  row: {
    height: ROW_HEIGHT,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  slot: {
    width: ITEM_WIDTH,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: arena.hairlineHi,
    /* Contains the blend. See the note on FilterFace. */
    isolation: 'isolate',
  },
  /**
   * The unfiltered look: the white face of an ordinary shutter.
   *
   * The hairline that separates a graded swatch from the preview behind it is what would
   * otherwise draw a grey ring inside the shutter's white one, so this drops it — white on a
   * darkened viewfinder needs no help standing out.
   */
  faceNatural: {
    backgroundColor: chrome.text,
    borderWidth: 0,
  },
  shutterLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRing: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: SHUTTER_RING,
    borderColor: chrome.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterName: {
    color: marmalade[500],
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  disclaimer: {
    ...text.caption,
    color: arena.textFaint,
    textAlign: 'center',
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.lg,
  },
});
