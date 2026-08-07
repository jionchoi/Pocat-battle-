import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowCounterClockwise,
  ArrowLeft,
  BookBookmark,
  Check,
  DownloadSimple,
  Images,
  LockSimple,
  type IconProps,
} from 'phosphor-react-native';

import { Button } from '../../components/Button';
import { CircleButton } from '../../components/CircleButton';
import { ScoreBreakdown } from '../../components/ScoreBreakdown';
import { ConfirmSheet } from '../../components/BottomSheet';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { useAlbumStore } from '../../store/albumStore';
import { useCaptureStore } from '../../store/captureStore';
import {
  arena,
  chrome,
  hitSlopFor,
  marmalade,
  photoScrim,
  press,
  radii,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../../theme';
import { TierCrest } from '../../components/TierCrest';
import type { ScoredCapture } from '../../models';
import type { MapStackParamList } from '../../navigation/types';

/**
 * Score Result Screen (README section 5.2).
 *
 * The reveal. Arena context, because this is a committed full-screen moment rather than
 * a card in a list.
 *
 * ## Why the photo is the background
 *
 * The previous version showed the shot as a square card with the score underneath, which
 * is the layout of a receipt. The photo is now the full bleed behind everything, dimmed
 * hard, and the score sits on top of it at 100pt. The player has just spent four seconds
 * waiting for this cat to do something interesting; the payoff should look like a trophy
 * screen, not a summary row.
 *
 * The order things arrive in is the order the player cares about: the number, then the
 * tier crest, then the badges, then the tools for doing something with it. Putting the
 * caption field first would make them edit text before they know what they scored.
 *
 * The photo behind all of this is the file the camera just wrote, not the uploaded copy.
 * The player watched themselves take that frame; showing it needs no network and cannot
 * arrive late, and the compressed upload is not what they are owed at 100pt.
 *
 * ## The things you can do with a shot
 *
 * Two are decisions and sit side by side, filled differently so they read as two options
 * rather than as a button and its echo:
 *
 *   Save to Album  — keep it, privately. Commits the caption and exits.
 *   Share to feed  — publish it *and* keep it. Sharing has never meant "instead of
 *                    saving"; asking a player who just posted a photo whether they also
 *                    wanted it is a question with one answer.
 *
 * Three are adjustments and share a row of smaller controls, because none of them is
 * what the player came here to decide:
 *
 *   Save to Dex    — pin this shot as the cat's Dex tile. The tile otherwise shows your
 *                    highest-scoring photo of that cat, which is not always the one that
 *                    looks like the cat.
 *   Save to phone  — write the original file to the device photo library.
 *   Retake         — discard this capture and reopen the camera. Destructive, so it
 *                    confirms first.
 *
 * And a back arrow, which is none of the above: it leaves. The photo is in the album
 * either way, so the player who only wanted the number is not made to answer anything.
 *
 * There is always an explicit exit — no dead-end screens (DESIGN.md 6.3).
 */

type Nav = NativeStackNavigationProp<MapStackParamList, 'ScoreResult'>;

export function ScoreResultScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const result = useCaptureStore((s) => s.result);
  const localUri = useCaptureStore((s) => s.localUri);
  const resetCapture = useCaptureStore((s) => s.reset);
  const setCaption = useAlbumStore((s) => s.setCaption);
  const setShared = useAlbumStore((s) => s.setShared);
  const pinDexPhoto = useAlbumStore((s) => s.pinDexPhoto);
  const removePhoto = useAlbumStore((s) => s.remove);

  const [caption, setCaptionText] = useState('');
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [savedToPhone, setSavedToPhone] = useState(false);
  /** Which of the three small actions is mid-flight, so only that one shows a wait. */
  const [busy, setBusy] = useState<'dex' | 'phone' | null>(null);
  const [confirmingRetake, setConfirmingRetake] = useState(false);

  const reveal = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      reveal.value = 1;
      return;
    }

    reveal.value = withDelay(120, withSpring(1, spring.overshoot));
  }, [reduceMotion, reveal]);

  const scoreStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: 0.86 + reveal.value * 0.14 }],
  }));

  const done = useCallback(() => {
    resetCapture();
    // Back to the map, not back to the camera: `replace` was used to get here, so the
    // camera is no longer on the stack and popping lands on the map.
    navigation.goBack();
  }, [navigation, resetCapture]);

  /**
   * "Save to Album" — the keep-it-and-leave action.
   *
   * The photo reached the album at capture time, so what is actually written here is the
   * caption. Committing it on the way out is the honest shape: the player is agreeing to
   * everything on this screen at once, and a separate "save caption" button would ask
   * them to confirm the same photo twice.
   */
  const saveToAlbum = useCallback(async () => {
    if (!result || caption.trim().length === 0) {
      done();
      return;
    }

    setSaving(true);
    try {
      await setCaption(result.photo.id, caption.trim());
      done();
    } catch {
      showToast('We could not save that caption. It is still in your album.', 'error');
      setSaving(false);
    }
  }, [caption, done, result, setCaption]);

  /**
   * "Share to feed" — the publish action, which keeps the photo as well.
   *
   * Sharing includes saving. Save-to-Album is the *private* half of the pair: it means
   * "mine only". Posting a photo and then being asked whether you also wanted to keep it
   * is a question with one sensible answer, so this commits the caption too and leaves,
   * exactly as Save to Album does.
   */
  const shareToFeed = useCallback(async () => {
    if (!result) return;

    setSharing(true);
    try {
      // Sharing outward also shares inward: a photo the player is posting elsewhere is
      // one they have decided is public, so it goes to the community feed too.
      if (!result.photo.sharedToFeed) {
        await setShared(result.photo.id, true);
      }

      if (caption.trim().length > 0) {
        await setCaption(result.photo.id, caption.trim());
      }

      await Share.share({
        message: caption.trim() || result.photo.badges[0] || 'A cat, caught mid-moment.',
        url: result.photo.imageUrl || undefined,
      });

      done();
    } catch {
      showToast('We could not share that. It is saved in your album.', 'error');
      setSharing(false);
    }
  }, [caption, done, result, setCaption, setShared]);

  /**
   * Pins this shot as the cat's Dex tile.
   *
   * The cat is already in the Dex — capture put it there. What this changes is *which*
   * photo represents it, which is otherwise the highest-scoring one you have.
   */
  const saveToDex = useCallback(async () => {
    if (!result || pinned) return;

    /*
     * Nothing to pin to yet.
     *
     * A Dex card belongs to a cat, and a freshly captured photo has no cat until the
     * player confirms which one it is — `photo.catId` is empty until then. Rather than
     * pin to nothing, this says so; the control comes back with identification.
     */
    if (!result.photo.catId) {
      showToast('Identify the cat first, then you can pin this photo to its card.', 'neutral');
      return;
    }

    setBusy('dex');
    try {
      await pinDexPhoto(result.photo.catId, result.photo.id);
      setPinned(true);
      showToast(`This is now ${result.photo.catNickname}'s photo in your Dex.`, 'success');
    } catch {
      showToast('We could not update your Dex entry.', 'error');
    } finally {
      setBusy(null);
    }
  }, [pinDexPhoto, pinned, result]);

  /**
   * Writes the capture to the device photo library.
   *
   * The original file straight off the camera, not a re-download of the upload — the
   * upload is resized and recompressed for scoring, and a copy the player keeps forever
   * should not be the lossy one.
   */
  const saveToPhone = useCallback(async () => {
    if (savedToPhone) return;

    if (!localUri) {
      showToast('That photo is no longer on this device.', 'error');
      return;
    }

    setBusy('phone');
    try {
      // `writeOnly` asks for the narrower add-only permission where the OS offers it, so
      // saving one photo never requests read access to the player's entire library.
      const permission = await MediaLibrary.requestPermissionsAsync(true);

      if (!permission.granted) {
        showToast('Cat Frame needs permission to add photos to your library.', 'error');
        return;
      }

      await MediaLibrary.saveToLibraryAsync(localUri);
      setSavedToPhone(true);
      showToast('Saved to your photos.', 'success');
    } catch {
      showToast('We could not save that to your photos.', 'error');
    } finally {
      setBusy(null);
    }
  }, [localUri, savedToPhone]);

  /**
   * Throws the capture away and reopens the camera.
   *
   * The photo is uploaded before this screen renders, so a retake has to delete it —
   * otherwise every rejected shot piles up in the album against the player's limit. The
   * camera is reached with `replace` so backing out of it lands on the map rather than on
   * the result for a photo that no longer exists.
   */
  const retake = useCallback(async () => {
    setConfirmingRetake(false);

    if (result) {
      try {
        await removePhoto(result.photo.id);
      } catch {
        showToast('That shot could not be deleted — it is still in your album.', 'error');
      }
    }

    resetCapture();
    navigation.replace('Capture');
  }, [navigation, removePhoto, resetCapture, result]);

  /**
   * Guard against a missing result.
   *
   * Reachable if the screen is restored from a cold start — the capture store is
   * deliberately ephemeral, so there is nothing to show and the honest move is to say so
   * rather than render a card full of zeroes.
   */
  if (!result) {
    return (
      <View style={[styles.root, styles.empty]}>
        <StatusBar style="light" />
        <Text style={[text.h2, { color: arena.text }]}>That result has expired</Text>
        <Text style={[text.body, styles.emptyBody]}>
          The photo is safe in your album. Open it there to see the full breakdown.
        </Text>
        <Button label="Back to the map" context="arena" onPress={done} />
      </View>
    );
  }

  const { photo, allowance, scored } = result;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/*
        The shot itself, full bleed and dimmed to a backdrop.

        The on-device file wins over the uploaded URL: it is the exact frame the player
        just took, it is already on disk, and it renders on the first frame of the reveal
        instead of fading in behind the score whenever the network is slow. The URL is the
        fallback for a screen that outlived the camera's cache directory.
      */}
      <Image
        source={localUri || photo.imageUrl || undefined}
        contentFit="cover"
        transition={localUri ? 0 : 320}
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityLabel={`Your photo of ${photo.catNickname}`}
      />

      {/*
        One gradient, not two flat washes. The previous version laid a 92%-black rectangle
        over the bottom 55% of the frame, which did not read as a scrim at all — it read
        as the photo being cropped in half with a black panel under it. A scrim has to
        have no edge of its own; the moment you can see where it starts, it has stopped
        being light and become a shape.
      */}
      <LinearGradient
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        colors={[
          photoScrim.revealTop,
          'rgba(0, 0, 0, 0.34)',
          photoScrim.revealMid,
          photoScrim.revealBottom,
        ]}
        locations={[0, 0.3, 0.66, 1]}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/*
          Two heroes, and which one shows is the whole shape of this screen.

          A scored capture gets the number it came for. One beyond the allowance gets the
          photograph, kept and safe, and an honest sentence about when it can be judged —
          not an error, and not a zero dressed up as a score. The shutter was never the
          thing being rationed.
        */}
        <Animated.View style={[styles.hero, scoreStyle]}>
          {scored ? (
            <>
              <Text style={[text.eyebrow, styles.eyebrow]}>Your score</Text>
              <Text style={[text.displayHuge, styles.score]}>{photo.scores.total}</Text>

              <TierCrest tier={photo.tier} style={styles.crest} />
              <Text style={[text.h2, styles.tierLabel]}>{photo.tier}</Text>
            </>
          ) : (
            <>
              <Text style={[text.eyebrow, styles.eyebrow]}>Saved, not yet scored</Text>
              <View style={styles.lockedMark}>
                <LockSimple size={40} weight="fill" color={arena.textMuted} />
              </View>
              <Text style={[text.h2, styles.tierLabel]}>In your album</Text>
              <Text style={[text.bodySm, styles.subtitle]}>
                {allowanceLine(allowance)}
              </Text>
            </>
          )}
        </Animated.View>

        {/*
          Badges are the one place tilt is allowed. They are the closest thing this app
          has to stickers, and stickers put on straight look printed rather than applied.
        */}
        {scored && photo.badges.length > 0 ? (
          <View style={styles.badgeRow}>
            {photo.badges.map((badge, index) => (
              <View
                key={badge}
                style={[
                  styles.badgeChip,
                  { transform: [{ rotate: index % 2 === 0 ? '-4deg' : '3deg' }] },
                ]}
              >
                <Text style={[text.caption, { color: chrome.text }]}>{badge}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/*
          XP and rank-up used to sit here. Both are gone until something actually awards
          them — a "+0 XP" under a real score is worse than nothing, because it reads as
          the capture having been worth nothing.
        */}
        {scored && allowance.remaining !== null ? (
          <Text style={[text.caption, styles.xp]}>
            {allowance.remaining === 1
              ? '1 score left today'
              : `${allowance.remaining} scores left today`}
          </Text>
        ) : null}

        {/*
          The two decisions, side by side because they are alternatives rather than a
          first choice and a fallback — keep it to yourself, or put it out there.

          Both are filled, and they are filled differently. Two coral pills would be one
          button drawn twice; white-on-black against coral-on-black separates them by
          shape and weight, not by which one you happen to read first. The glyphs carry
          the same split: an album for the private half, the outward arrow — the same
          arrow every other share in the app uses — for the public one.
        */}
        <View style={styles.actions}>
          <View style={styles.actionCell}>
            <Button
              label="Save to Album"
              onPress={() => void saveToAlbum()}
              context="arena"
              tone="contrast"
              icon={Images}
              loading={saving}
              trailingIcon
              compact
              fullWidth
              accessibilityHint="Keeps this photo in your album only"
            />
          </View>
          <View style={styles.actionCell}>
            <Button
              label="Share to feed"
              onPress={() => void shareToFeed()}
              context="arena"
              loading={sharing}
              trailingIcon
              compact
              fullWidth
              accessibilityHint="Posts it to the community feed and keeps it in your album"
            />
          </View>
        </View>

        {/* The three adjustments. Smaller, because none of them is the point of the screen. */}
        <View style={styles.miniRow}>
          <MiniAction
            icon={pinned ? Check : BookBookmark}
            label={pinned ? 'Dex photo' : 'Save to Dex'}
            hint={`Use this photo on ${photo.catNickname}'s card in your Cat Dex`}
            done={pinned}
            busy={busy === 'dex'}
            onPress={() => void saveToDex()}
          />
          <MiniAction
            icon={savedToPhone ? Check : DownloadSimple}
            label={savedToPhone ? 'On your phone' : 'Save to phone'}
            hint="Save the original to your device photo library"
            done={savedToPhone}
            busy={busy === 'phone'}
            onPress={() => void saveToPhone()}
          />
          <MiniAction
            icon={ArrowCounterClockwise}
            label="Retake"
            hint="Discard this photo and open the camera again"
            onPress={() => setConfirmingRetake(true)}
          />
        </View>

        {/*
          "Save to Dex" is the only one of the three whose name does not describe what it
          does — the cat is in the Dex either way, and what the button changes is which
          photo the Dex shows for it. So the screen says so, in the place where the button
          is, rather than leaving the player to press it and guess what moved.
        */}
        <Text style={[text.caption, styles.miniNote]}>
          {pinned
            ? `${photo.catNickname}'s card in your Cat Dex now shows this photo.`
            : `Save to Dex sets the cover photo on ${photo.catNickname}'s Cat Dex card. It shows your highest-scoring shot of them until you choose one.`}
        </Text>

        {/*
          Everything below is opt-in. A player who just wants to see the number, share it
          and get back to the street should never have to scroll past a text field and a
          report card to reach the exit — but a player who wants to know *why* they scored
          87 gets the full breakdown one tap away.
        */}
        <DetailToggle open={showDetail} onPress={() => setShowDetail((v) => !v)} />

        {showDetail ? (
          <View style={styles.detail}>
            <ScoreBreakdown
              scores={photo.scores}
              pose={photo.pose}
              tier={photo.tier}
              badges={[]}
              showTotal={false}
              animate
              context="arena"
            />

            <Text style={[text.caption, styles.layerNote]}>
              This is the app's take. Share it and the community decides your rank.
            </Text>

            <View style={styles.captionBlock}>
              <Text style={[text.h3, { color: arena.text }]}>Add a caption</Text>

              {/*
                The suggestion chips are gone with the response field that fed them.
                Nothing generates captions yet, and three empty chips would be a control
                that looks broken rather than one that is honestly absent.
              */}
              <TextField
                label="Caption"
                value={caption}
                onChangeText={setCaptionText}
                placeholder="Say something about this one"
                maxLength={140}
                context="arena"
                multiline
                helper="Suggestions are editable. Captions are optional."
              />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/*
        The way out that costs nothing. Every other control on this screen commits to
        something — keeps, publishes, pins, deletes — and a player who just wants to see
        the number and get back to the street needs a door that does none of them. The
        photo is already in the album, so leaving is not losing it.
      */}
      <CircleButton
        Glyph={ArrowLeft}
        onPress={done}
        context="arena"
        accessibilityLabel="Back to the map"
        accessibilityHint="Leaves this photo in your album without sharing it"
        style={[styles.back, { top: insets.top + spacing.xs }]}
      />

      <ConfirmSheet
        visible={confirmingRetake}
        onCancel={() => setConfirmingRetake(false)}
        onConfirm={() => void retake()}
        title="Retake this photo?"
        body={`The photo and its score of ${photo.scores.total} are deleted, and the camera opens again. The XP it earned you stays.`}
        confirmLabel="Delete and retake"
        cancelLabel="Keep this one"
        destructive
        context="arena"
      />
    </View>
  );
}

/**
 * When the next score frees up, in words.
 *
 * The window rolls, so there is no "tomorrow" to promise — the honest answer is a time, and
 * it comes from the server rather than being counted down here, because the clock that
 * matters is the one doing the rationing.
 */
function allowanceLine(allowance: ScoredCapture['allowance']): string {
  if (!allowance.resetsAt) return 'Open it from your album to reveal the score.';

  const at = new Date(allowance.resetsAt);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return `Your next score unlocks around ${time}. The photo is safe in your album until then.`;
}

/**
 * One of the three secondary actions.
 *
 * Not a `Button`: three of those in a row at this width would each be a stack of wrapped
 * words, and at ghost weight they would compete with the two real decisions above. A
 * glyph over a short label reads at a glance and stays one line.
 *
 * Completed actions swap the glyph for a tick and go quiet rather than disappearing —
 * a control that vanishes after use leaves the player unsure whether it worked.
 */
const MiniAction = React.memo(function MiniAction({
  icon: Glyph,
  label,
  hint,
  done = false,
  busy = false,
  onPress,
}: {
  icon: React.ComponentType<IconProps>;
  label: string;
  hint: string;
  done?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
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
      disabled={done || busy}
      onPressIn={() => {
        pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, press.config);
      }}
      hitSlop={hitSlopFor(64)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: done || busy }}
      style={styles.miniHit}
    >
      <Animated.View style={[styles.mini, animated, busy && styles.miniBusy]}>
        <Glyph
          size={20}
          weight={done ? 'bold' : 'regular'}
          color={done ? marmalade[500] : arena.text}
        />
        <Text
          numberOfLines={1}
          style={[text.caption, styles.miniLabel, done && styles.miniLabelDone]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

/** The disclosure for the breakdown. Text only — a chevron row here would read as a list. */
const DetailToggle = React.memo(function DetailToggle({
  open,
  onPress,
}: {
  open: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      label={open ? 'Hide the breakdown' : 'Why this score?'}
      variant="ghost"
      context="arena"
      onPress={onPress}
      style={styles.detailToggle}
    />
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: arena.bg,
  },
  /**
   * The back affordance floats over the photo rather than sitting in a header bar: this
   * screen has no chrome to put one in, and a bar would cut the frame at the top the way
   * the old scrim cut it across the middle.
   */
  back: {
    position: 'absolute',
    left: spacing.md,
    zIndex: 2,
  },
  content: {
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyBody: {
    color: arena.textMuted,
    marginBottom: spacing.md,
  },
  hero: {
    alignItems: 'center',
  },
  eyebrow: {
    color: arena.textMuted,
    letterSpacing: 2.4,
  },
  score: {
    color: chrome.text,
    marginTop: spacing.xs,
    fontSize: 100,
    lineHeight: 104,
  },
  crest: {
    marginTop: spacing.md,
  },
  tierLabel: {
    color: chrome.text,
    marginTop: spacing.sm,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: arena.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  badgeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radii.full,
    backgroundColor: arena.surface,
  },
  rankUp: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: arena.surface,
    alignItems: 'center',
  },
  xp: {
    marginTop: spacing.md,
    color: arena.textFaint,
  },
  actions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    // Sits well clear of the XP line above it: the two decisions are the bottom third of
    // this screen, not the next item in a list of facts about the photo.
    marginTop: spacing.xxl,
    gap: spacing.xs,
  },
  /**
   * Equal columns come from `flex: 1` on a wrapper rather than from a width on the button
   * — the button sizes itself from its label, and a percentage width on it would let the
   * longer of the two labels decide both columns.
   */
  actionCell: {
    flex: 1,
  },
  miniRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.xxs,
    // A real break under the decisions. At 8pt the adjustments read as a third button
    // row; at 16 they read as a different kind of thing, which is what they are.
    marginTop: spacing.md,
  },
  miniHit: {
    flex: 1,
  },
  mini: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.lg,
    backgroundColor: arena.surface,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  /** In-flight, not disabled: the row must not reflow while one of three is working. */
  miniBusy: {
    opacity: 0.5,
  },
  miniLabel: {
    color: arena.textMuted,
  },
  miniLabelDone: {
    color: marmalade[500],
  },
  /** Stands in for the crest on a capture that has not been judged yet. */
  lockedMark: {
    marginTop: spacing.md,
    width: 72,
    height: 72,
    borderRadius: radii.full,
    backgroundColor: arena.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniNote: {
    marginTop: spacing.xs,
    color: arena.textFaint,
    textAlign: 'center',
  },
  detailToggle: {
    marginTop: spacing.xs,
  },
  detail: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.xxl,
    backgroundColor: arena.sunken,
  },
  layerNote: {
    marginTop: spacing.md,
    color: arena.textFaint,
  },
  captionBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  suggestions: {
    marginBottom: spacing.xxs,
  },
});
