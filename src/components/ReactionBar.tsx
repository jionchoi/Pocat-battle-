import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { REACTIONS, REACTION_EMOJI, REACTION_LABELS } from '../constants/game';
import type { Reaction } from '../models';
import { usePawStore } from '../store/pawStore';
import {
  contextColors,
  elevation,
  marmalade,
  spacing,
  spring,
  text,
  useReduceMotion,
  type ContextName,
} from '../theme';
import { compactNumber } from '../utils/format';

/**
 * The reaction bar — two buttons, split down the middle.
 *
 * ## The shape
 *
 * A heart on the left and a paw on the right, each taking half the row. Equal halves are
 * the argument: these are the two things a reader can spend on somebody else's photograph,
 * and a layout that gave one of them more room would be ranking them before the player has
 * decided which they care about.
 *
 *  - **Left, the heart.** One tap is a heart, which is the reaction nine readers in ten
 *    want and should never have to open a menu for. **Hold** it and the other faces rise
 *    above the button — the iMessage tapback, kept for the one case it is genuinely good
 *    at: the reaction you have to think about.
 *  - **Right, the paw.** The in-game currency, given to the photograph. One tap gives one
 *    paw, for good — see `usePawGift`, which owns that rule and the toast that reports it.
 *
 * Once you have reacted, the left button *wears your reaction* rather than staying a heart.
 * The button is a readout as much as a control, and a heart sitting over a photo you
 * actually marked with fire would be lying about what you said.
 *
 * ## Why the tray can be a real popover here
 *
 * It is drawn at `bottom: 100%` of the left half, floating over whatever is above the bar.
 * That is safe at all four call sites even though two of them put this inside `PhotoCard`,
 * which clips to its own rounded corners: the bar sits at the *bottom* of that card, so a
 * tray 40pt above it lands over the card's caption rather than outside its bounds. On a
 * feed post it lands over the photograph, which is where a tapback belongs anyway.
 */

/**
 * Milliseconds an untouched tray stays open.
 *
 * There is no backdrop to dismiss against — that would need a portal, and this lives inside
 * a card in a virtualized list. A timeout is the honest substitute: long enough to read four
 * faces, short enough that a mis-hold does not leave a menu sitting open on the feed.
 */
const TRAY_TIMEOUT = 4_000;

/** What one tap means. Everything else is behind the hold. */
const PRIMARY: Reaction = 'love';

/** The paw is an emoji, not a Phosphor glyph, so both halves are the same kind of mark. */
const PAW_EMOJI = '🐾';

export type ReactionBarSize = 'sm' | 'lg';

const METRICS = {
  sm: { height: 34, emoji: 16, tray: 36, trayEmoji: 20 },
  lg: { height: 44, emoji: 20, tray: 44, trayEmoji: 25 },
} as const;

type Metrics = (typeof METRICS)[ReactionBarSize];

export const ReactionBar = React.memo(function ReactionBar({
  photoId,
  reactions,
  myReaction,
  onReact,
  pawCount,
  onGivePaw,
  disabled = false,
  size = 'sm',
  context = 'paper',
  style,
}: {
  /** Identifies the photo to `pawStore`, which knows what this device has already given. */
  photoId: string;
  reactions: Record<Reaction, number>;
  myReaction: Reaction | null;
  onReact: (reaction: Reaction) => void;
  /** Paws this photograph has been given, by everyone. Mirrors the heart's total. */
  pawCount: number;
  onGivePaw: () => void;
  /**
   * True on your own photos.
   *
   * It governs **both halves**. It used to reach only the heart, so the paw was pressable on
   * your own work — which the server refuses, but only after the tap had already looked like
   * it worked. You cannot react to yourself and you cannot tip yourself, and the two refusals
   * are the same fact about who is asking.
   */
  disabled?: boolean;
  /** `sm` rides under a feed card; `lg` is Photo Detail, where the row runs at 44pt. */
  size?: ReactionBarSize;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const metrics = METRICS[size];

  const [trayOpen, setTrayOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeTray = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setTrayOpen(false);
  }, []);

  const openTray = useCallback(() => {
    if (disabled) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTrayOpen(false), TRAY_TIMEOUT);
    setTrayOpen(true);
  }, [disabled]);

  useEffect(() => {
    if (disabled) closeTray();
  }, [closeTray, disabled]);

  // Clears a pending close when the row scrolls out of a list and unmounts mid-gesture.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const total = useMemo(
    () => REACTIONS.reduce((sum, key) => sum + (reactions[key] ?? 0), 0),
    [reactions]
  );

  /**
   * A tap leaves a heart, or takes back whatever you left.
   *
   * Both halves of that are what "one tap is just heart" has to mean once the button also
   * shows your reaction: with nothing left, the tap leaves a heart; with something left,
   * the button is showing it and the obvious thing for a tap to do is undo it. Re-sending
   * the held reaction is how the rest of the app already spells "clear" — see
   * `usePhotoReaction`, where tapping what you hold is the clear.
   */
  const tap = useCallback(() => {
    if (trayOpen) {
      closeTray();
      return;
    }
    onReact(myReaction ?? PRIMARY);
  }, [closeTray, myReaction, onReact, trayOpen]);

  const pick = useCallback(
    (reaction: Reaction) => {
      closeTray();
      onReact(reaction);
    },
    [closeTray, onReact]
  );

  const shown = myReaction ?? PRIMARY;
  const mine = myReaction !== null;

  return (
    <View style={[styles.bar, style]}>
      <View style={styles.half}>
        <HalfButton
          emoji={REACTION_EMOJI[shown]}
          count={total}
          active={mine}
          disabled={disabled}
          metrics={metrics}
          context={context}
          onPress={tap}
          onLongPress={openTray}
          accessibilityLabel={
            mine
              ? `You reacted ${REACTION_LABELS[shown]}. ${total} in total. Tap to undo, hold for the other reactions.`
              : `${total} ${total === 1 ? 'reaction' : 'reactions'}. Tap to love this, hold for the other reactions.`
          }
        />

        {/*
          After the button in source order and lifted on both axes of stacking — `zIndex`
          for iOS, and the `elevation` token for Android, which ignores zIndex between
          siblings that have no elevation of their own.
        */}
        <Tray
          open={trayOpen}
          myReaction={myReaction}
          reactions={reactions}
          onPick={pick}
          metrics={metrics}
          context={context}
        />
      </View>

      <PawButton
        photoId={photoId}
        count={pawCount}
        disabled={disabled}
        onPress={onGivePaw}
        metrics={metrics}
        context={context}
      />
    </View>
  );
});

/**
 * One half of the bar: a big mark and its count.
 *
 * No label. The two marks are the whole vocabulary, and a word under a heart would be the
 * only text on a row that is otherwise readable at a glance.
 */
const HalfButton = React.memo(function HalfButton({
  emoji,
  count,
  active,
  disabled,
  metrics,
  context,
  onPress,
  onLongPress,
  accessibilityLabel,
}: {
  emoji: string;
  count: number;
  active: boolean;
  disabled: boolean;
  metrics: Metrics;
  context: ContextName;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
}) {
  const c = contextColors(context);
  const reduceMotion = useReduceMotion();
  const pop = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const handlePress = () => {
    if (!reduceMotion) {
      // The mark answers the thumb before the network does. Overshoot, so it reads as a
      // physical response rather than as a state change.
      pop.value = withSequence(
        withSpring(1.22, spring.overshoot),
        withSpring(1, spring.snap)
      );
    }
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      /*
       * Shorter than the platform default of 500ms. The tray is the *second* thing this
       * button does, and half a second of holding a heart with nothing happening reads as
       * a button that did not register the press.
       */
      delayLongPress={260}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.button,
        {
          height: metrics.height,
          borderRadius: metrics.height / 2,
          backgroundColor: active ? marmalade[100] : c.sunken,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Animated.Text
        allowFontScaling={false}
        style={[
          styles.emoji,
          { fontSize: metrics.emoji, lineHeight: metrics.emoji * 1.25 },
          animated,
        ]}
      >
        {emoji}
      </Animated.Text>

      {/*
        Zero is drawn rather than hidden. The halves are fixed and side by side, so a count
        that appeared on the first tap would shove the mark beside it — and a bar that
        twitches when you press it reads as a layout bug rather than as a response.
      */}
      <Text style={[text.stat, { color: active ? marmalade[600] : c.textMuted }]}>
        {compactNumber(count)}
      </Text>
    </Pressable>
  );
});

/**
 * The faces behind the hold.
 *
 * Four of them, never five: the button that opened the tray is already wearing one, and
 * offering it again would be offering a choice the player has just made. So the tray is
 * always "the ones you have not got" — hold a heart and you get the other four; hold a
 * fire and the heart takes the free slot. Four wide either way, so the popover does not
 * change size as the player's mind does.
 *
 * Each face springs up behind the last, 26ms apart, which is what makes the row read as
 * something that opened rather than something that was always there.
 */
const Tray = React.memo(function Tray({
  open,
  myReaction,
  reactions,
  onPick,
  metrics,
  context,
}: {
  open: boolean;
  myReaction: Reaction | null;
  reactions: Record<Reaction, number>;
  onPick: (reaction: Reaction) => void;
  metrics: Metrics;
  context: ContextName;
}) {
  const c = contextColors(context);
  const reduceMotion = useReduceMotion();
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = reduceMotion
      ? open
        ? 1
        : 0
      : open
        ? withSpring(1, spring.overshoot)
        : withTiming(0, { duration: 120 });
  }, [open, reduceMotion, shown]);

  const animated = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [
      { scale: 0.86 + 0.14 * shown.value },
      { translateY: (1 - shown.value) * 8 },
    ],
  }));

  const faces = REACTIONS.filter((key) => key !== (myReaction ?? PRIMARY));

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[
        styles.tray,
        {
          height: metrics.tray,
          borderRadius: metrics.tray / 2,
          backgroundColor: c.surface,
          borderColor: c.hairlineHi,
        },
        elevation('floating', context),
        animated,
      ]}
    >
      {faces.map((reaction, index) => (
        <TrayFace
          key={reaction}
          reaction={reaction}
          count={reactions[reaction] ?? 0}
          open={open}
          index={index}
          metrics={metrics}
          onPress={() => onPick(reaction)}
        />
      ))}
    </Animated.View>
  );
});

const TrayFace = React.memo(function TrayFace({
  reaction,
  count,
  open,
  index,
  metrics,
  onPress,
}: {
  reaction: Reaction;
  count: number;
  open: boolean;
  index: number;
  metrics: Metrics;
  onPress: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const enter = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      enter.value = open ? 1 : 0;
      return;
    }

    enter.value = open
      ? withDelay(index * 26, withSpring(1, spring.overshoot))
      : withTiming(0, { duration: 90 });
  }, [enter, index, open, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.5 + 0.5 * enter.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${REACTION_LABELS[reaction]}${count > 0 ? `, ${count}` : ''}`}
      style={[styles.trayFace, { width: metrics.tray - 6, height: metrics.tray - 6 }]}
    >
      <Animated.Text
        allowFontScaling={false}
        style={[
          styles.emoji,
          { fontSize: metrics.trayEmoji, lineHeight: metrics.trayEmoji * 1.25 },
          animated,
        ]}
      >
        {REACTION_EMOJI[reaction]}
      </Animated.Text>
    </Pressable>
  );
});

/**
 * The paw. The other half of the bar, and the half that costs something.
 *
 * It shows the photograph's total the way the heart shows its total, and it wears a
 * highlight once *this device* has given one — the same readout-as-control the left half
 * has, where the button says what you already did as well as offering to do it again.
 *
 * ## Why this one reaches into the store and the heart does not
 *
 * `myReaction` is threaded down from the callers because they merge it into their photo
 * lists inside the `useMemo` that packs a feed page — it is derived data on a scrolling
 * list, and recomputing it per frame is exactly what that memo exists to avoid. "Have I
 * tipped this one" is not on that path: it is one boolean, read by one button, and passing
 * it through four call sites and a memo boundary would be more machinery than the fact is
 * worth. The selector re-renders this button and nothing else.
 *
 * Multiple paws to one photograph are allowed, so the highlight means "you have given",
 * not "you have finished" — the button stays live.
 */
const PawButton = React.memo(function PawButton({
  photoId,
  count,
  disabled,
  onPress,
  metrics,
  context,
}: {
  photoId: string;
  count: number;
  disabled: boolean;
  onPress: () => void;
  metrics: Metrics;
  context: ContextName;
}) {
  const given = usePawStore((s) => s.givenByPhotoId[photoId] ?? 0);

  return (
    <View style={styles.half}>
      <HalfButton
        emoji={PAW_EMOJI}
        count={count}
        active={given > 0}
        disabled={disabled}
        metrics={metrics}
        context={context}
        onPress={onPress}
        accessibilityLabel={
          disabled
            ? `${count} paws. You cannot give paws to your own photo.`
            : given > 0
              ? `${count} paws, ${given} from you. Tap to give another.`
              : `${count} ${count === 1 ? 'paw' : 'paws'}. Tap to give one.`
        }
      />
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  /**
   * Half the row each, and the anchor the tray hangs off.
   *
   * `flex: 1` on both is what makes them equal at any width without measuring — and it is
   * why the left half is a wrapper rather than the button itself: an absolutely positioned
   * tray needs a positioned parent that is not also the thing being pressed, or the press
   * scale would drag the popover around with it.
   */
  half: {
    flex: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  /**
   * Emoji sit high in their line box on both platforms and ignore `color`. Pinning the line
   * height to the size is what keeps a face centred against the numeral beside it, and
   * `allowFontScaling={false}` keeps a 20pt mark inside a 44pt pill at every text size.
   */
  emoji: {
    textAlign: 'center',
  },
  /**
   * Floating clear of the button it belongs to.
   *
   * `bottom: '100%'` puts it directly above the left half — over the photograph on a feed
   * post, over the caption inside a `PhotoCard`. Both are within the clipping bounds of
   * whatever is drawing it, which is what lets this be a real popover.
   */
  tray: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
    gap: 2,
    borderWidth: 1,
    zIndex: 10,
  },
  trayFace: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
