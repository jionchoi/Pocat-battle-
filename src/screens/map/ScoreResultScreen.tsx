import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowCounterClockwise,
  ArrowLeft,
  BookBookmark,
  Check,
  DownloadSimple,
  Images,
  LockSimple,
  MapPin,
  MapPinSimpleArea,
  type IconProps,
} from 'phosphor-react-native';

import { useStatusBarStyle } from '../../components/Screen';
import { Button } from '../../components/Button';
import { CircleButton } from '../../components/CircleButton';
import { ScoreBreakdown } from '../../components/ScoreBreakdown';
import { BottomSheet, ConfirmSheet } from '../../components/BottomSheet';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { photoApi } from '../../api/endpoints';
import { AlbumFullSheet } from '../../components/AlbumFullSheet';
import { IdentifySheet } from '../../components/IdentifySheet';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
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
import type { IdentifyChoice, ScoreFailure, ScoredCapture } from '../../models';
import type { MainTabParamList, MapStackParamList } from '../../navigation/types';

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

/**
 * Composite, because one control on this screen leaves the tab it lives in.
 *
 * Everything else here navigates inside the map stack; "Go Pro" on the full-album sheet
 * targets the shop, which hangs off the profile tab. Typing it this way is what makes that
 * jump checked rather than a cast.
 */
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<MapStackParamList, 'ScoreResult'>,
  BottomTabNavigationProp<MainTabParamList>
>;

export function ScoreResultScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const result = useCaptureStore((s) => s.result);
  const localUri = useCaptureStore((s) => s.localUri);
  const resetCapture = useCaptureStore((s) => s.reset);
  const succeed = useCaptureStore((s) => s.succeed);
  const setCaption = useAlbumStore((s) => s.setCaption);
  const setShared = useAlbumStore((s) => s.setShared);
  const setSharedToMap = useAlbumStore((s) => s.setSharedToMap);
  const pinDexPhoto = useAlbumStore((s) => s.pinDexPhoto);
  const identifyPhoto = useAlbumStore((s) => s.identify);
  const removePhoto = useAlbumStore((s) => s.remove);
  const albumPhotos = useAlbumStore((s) => s.photos);
  const loadAlbum = useAlbumStore((s) => s.load);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const applyCaptureRewards = useAuthStore((s) => s.applyCaptureRewards);

  const [caption, setCaptionText] = useState('');
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [savedToPhone, setSavedToPhone] = useState(false);
  /**
   * Seeded from the capture rather than assumed on.
   *
   * The column defaults true today, and a screen that hard-coded that would keep drawing
   * "on" on the day the default changes or a per-player setting starts deciding it. The
   * server's answer for this photo is the one thing that is always right.
   */
  const [onMap, setOnMap] = useState(result?.photo.sharedToMap ?? true);
  /**
   * Set once the player has answered the full-album prompt, so the sheet does not come
   * straight back.
   *
   * Needed because `result` is the capture response and never changes — it reported
   * `overflowing` at the moment the photo landed, which stays true as a historical fact
   * long after the deletion that fixed it.
   */
  const [albumResolved, setAlbumResolved] = useState(false);
  /**
   * Set when the player closes the scoring-failure sheet without resolving it.
   *
   * Dismissing is a real answer here, unlike the full-album sheet: the photograph is saved
   * and unscored, which is a state the album already knows how to draw, so walking away
   * costs nothing and strands nothing.
   */
  const [failureDismissed, setFailureDismissed] = useState(false);
  /** Which of the small actions is mid-flight, so only that one shows a wait. */
  const [busy, setBusy] = useState<
    'dex' | 'phone' | 'map' | 'album' | 'score' | 'retake' | null
  >(
    null
  );
  const [confirmingRetake, setConfirmingRetake] = useState(false);
  /**
   * Set once the player has answered — or declined to answer — which cat this is.
   *
   * Declining is a real answer, so the same flag closes the sheet either way. It is local
   * state rather than derived from `photo.catId` because a player who dismissed the question
   * must not have it raised again by the next render, and `identify` is deliberately free to
   * call later from the album.
   */
  const [identifyResolved, setIdentifyResolved] = useState(false);
  const [identifying, setIdentifying] = useState(false);

  const reveal = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      reveal.value = 1;
      return;
    }

    reveal.value = withDelay(120, withSpring(1, spring.overshoot));
  }, [reduceMotion, reveal]);

  // The store fills `result` before this screen is navigated to, so the initial state is
  // normally already right. This is for the case where it is not, rather than a guess that
  // it always will be.
  useEffect(() => {
    if (result) setOnMap(result.photo.sharedToMap);
  }, [result]);

  /**
   * Moves the profile meter the moment the score lands.
   *
   * Keyed on the photo id rather than run on mount, because `result` is replaced when a
   * failed score is retried successfully — that swap is the second time this screen has a
   * scored capture in hand, and it is the first time there is an award to apply.
   *
   * The ref is what stops it being applied twice for one photograph. `succeed` also fires on
   * an identification, which rewrites `result` with the same award attached to it.
   */
  const creditedPhotoId = useRef<string | null>(null);

  useEffect(() => {
    const earned = result?.award;
    if (!result || !earned) return;
    if (creditedPhotoId.current === result.photo.id) return;

    creditedPhotoId.current = result.photo.id;
    applyCaptureRewards({ award: earned, scoreAwarded: result.photo.scores.total });
  }, [applyCaptureRewards, result]);

  const scoreStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: 0.86 + reveal.value * 0.14 }],
  }));

  const done = useCallback(() => {
    /*
     * Leave first, clear second.
     *
     * `resetCapture` nulls the result this screen is drawn from, so doing it first renders
     * the "that result has expired" fallback on the way out — and if the navigation then
     * fails to go anywhere, that fallback is where the player is stranded, pressing a button
     * that has already done its only job.
     *
     * Back to the map, not back to the camera: `replace` was used to get here, so the camera
     * is not on the stack and popping lands on the map. The fallback covers a stack that has
     * no map underneath at all, which is a state this screen cannot fix by refusing to move.
     */
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.replace('Map');
    }

    resetCapture();
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
     * Nothing to pin to yet — so ask the question instead of reporting it.
     *
     * A Dex card belongs to a cat, and a freshly captured photo has no cat until the player
     * confirms which one it is: `photo.catId` is empty until then. This used to raise a toast
     * saying "identify the cat first" and stop, which named the prerequisite and then offered
     * no way to satisfy it — the identify sheet is shown once, on arrival, and a player who
     * dismissed it had no route back to it. The button looked broken because from where they
     * were standing it was.
     *
     * Reopening the sheet is that route. `identifyResolved` is what closed it, so clearing it
     * is what brings it back; `identifyOpen` still checks that the server offered candidates
     * at all, so this cannot conjure a sheet with nothing in it.
     */
    if (!result.photo.catId) {
      if (result.candidates !== undefined) {
        setIdentifyResolved(false);
        return;
      }

      showToast('This photo has no cat on it to pin yet.', 'neutral');
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
   * Asks for the score again on a photo that could not be judged the first time.
   *
   * Costs nothing to attempt. The reveal is charged only when a score actually lands — the
   * ledger row is written after the score, never before — so a failed attempt leaves the
   * allowance exactly where it was, and this button is not a gamble with one of the
   * player's two.
   *
   * The response is the same shape as the capture that produced this screen, so it simply
   * replaces it: succeeding swaps in a scored photo and the sheet falls away on its own,
   * because `scoreError` is what was holding it open.
   */
  const retryScore = useCallback(async () => {
    if (!result) return;

    setBusy('score');
    try {
      succeed(await photoApi.reveal(result.photo.id));
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'We could not reach the scorer.',
        'error'
      );
    } finally {
      setBusy(null);
    }
  }, [result, succeed]);

  /**
   * Records which cat this photograph is of.
   *
   * Costs no model call — matching reads traits already on the row — so this is pure Postgres
   * and a player may redo it as often as they like. The response carries the updated photo
   * and the Dex entry, and the store writes both.
   *
   * `succeed` is called with a patched capture so the screen behind the sheet catches up:
   * `photo.catNickname` is what "Save to Dex" and its explanatory note are written around,
   * and leaving the stale one there would show the player a cat's name they had just replaced.
   */
  const chooseCat = useCallback(
    async (choice: IdentifyChoice) => {
      if (!result) return;

      setIdentifying(true);
      try {
        const identification = await identifyPhoto(result.photo.id, choice);

        succeed({ ...result, photo: identification.photo });
        setIdentifyResolved(true);

        showToast(
          identification.created
            ? `${identification.cat.nickname} is now in your Cat Dex.`
            : `Saved as ${identification.cat.nickname}.`,
          'success'
        );
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'We could not save that. Try again.',
          'error'
        );
      } finally {
        setIdentifying(false);
      }
    },
    [identifyPhoto, result, succeed]
  );

  /*
   * The album is over its cap and the sheet needs something to offer.
   *
   * Loaded here rather than assumed present: the reveal screen lives on the map stack and a
   * player can reach it without ever having opened their album this session, in which case
   * the store holds nothing. Not forced — a cached album is a fine thing to choose from,
   * and the delete itself is validated server-side.
   */
  const albumFull = (result?.album.overflowing ?? false) && !albumResolved;

  useEffect(() => {
    if (albumFull) void loadAlbum();
  }, [albumFull, loadAlbum]);

  /**
   * Deletes an older photo to make room for this one.
   *
   * The store's `remove` already handles the album list, the local file and the Dex entry
   * that pointed at it. What is added here is the profile refresh, because the storage
   * meter and the 90%-full warning both read `Me.photoCount` and would otherwise keep
   * reporting the album as full until something else happened to refetch it.
   */
  const deleteExisting = useCallback(
    async (photoId: string) => {
      setBusy('album');
      try {
        await removePhoto(photoId);
        setAlbumResolved(true);
        void refreshUser();
      } catch {
        showToast('We could not delete that photo. Try another one.', 'error');
      } finally {
        setBusy(null);
      }
    },
    [refreshUser, removePhoto]
  );

  /**
   * Throws away the capture that overflowed the album, and leaves.
   *
   * Deliberately does not reopen the camera the way Retake does. Retake means "that shot
   * was bad, let me try again", and taking another photograph is exactly what this player
   * cannot do — the album is why they are here. Sending them back to the camera would end
   * in the same sheet with one fewer reveal.
   */
  const discardNew = useCallback(async () => {
    if (!result) return;

    setBusy('album');
    try {
      await removePhoto(result.photo.id);
      setAlbumResolved(true);
      void refreshUser();
      resetCapture();
      navigation.goBack();
    } catch {
      showToast('We could not discard that photo. Try again.', 'error');
      setBusy(null);
    }
  }, [navigation, refreshUser, removePhoto, resetCapture, result]);

  /**
   * Takes this capture's pin off the map, or puts it back.
   *
   * Written immediately rather than committed with "Done", matching the sharing toggle in
   * the album — two switches that look alike and save at different moments is a worse
   * inconsistency than one redundant request from a player who flips it twice. It also
   * means a player who leaves through the back arrow, which commits nothing else on this
   * screen, still has their answer saved.
   */
  const toggleMap = useCallback(async () => {
    if (!result) return;
    const next = !onMap;

    setOnMap(next);
    setBusy('map');
    try {
      await setSharedToMap(result.photo.id, next);
    } catch {
      setOnMap(!next);
      showToast('We could not change that. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  }, [onMap, result, setSharedToMap]);

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
    /*
     * The sheet stays up while the delete runs, showing the paw trail on its own button.
     *
     * It used to close on the first frame and then sit on the reveal for as long as the
     * round trip took, with nothing anywhere saying the tap had registered — and this path
     * deletes a photograph, so silence is the one thing it must not do.
     */
    setBusy('retake');

    if (result) {
      try {
        await removePhoto(result.photo.id);
      } catch {
        showToast('That shot could not be deleted — it is still in your album.', 'error');
        setBusy(null);
        setConfirmingRetake(false);
        return;
      }
    }

    setConfirmingRetake(false);
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
  /*
   * Both branches of this screen are the arena — a photograph under a black wash — so the
   * clock inverts for either. Applied on focus, not on mount: see the note in `Screen`.
   */
  useStatusBarStyle('light');

  if (!result) {
    return (
      <View style={[styles.root, styles.empty]}>
        <Text style={[text.h2, { color: arena.text }]}>That result has expired</Text>
        <Text style={[text.body, styles.emptyBody]}>
          The photo is safe in your album. Open it there to see the full breakdown.
        </Text>
        <Button label="Back to the map" context="arena" onPress={done} />
      </View>
    );
  }

  const { photo, allowance, scored, award } = result;

  /*
   * Three sheets can apply to one capture, and only one may be on screen at a time.
   *
   * Stacked bottom sheets are unreadable, so they queue by urgency rather than by which
   * condition was evaluated first. The scoring failure goes first because it is the only one
   * holding a button worth pressing while the moment lasts; the full album next, because it
   * is the only one that must be answered; identification last, because it is the only one
   * that is equally answerable a week from now.
   */
  const failureOpen = result.scoreError !== null && !failureDismissed;
  const albumSheetOpen = albumFull && result.scoreError === null;

  /**
   * Whether there is a cat to ask about at all.
   *
   * `candidates` absent and `candidates: []` are different answers and the difference decides
   * whether this opens. Absent is a server with no matching — the sheet must never appear.
   * Empty is the matcher having looked and found nobody nearby, which is the "add a new cat"
   * prompt and the only way a first cat ever gets recorded.
   */
  const identifyOpen =
    result.candidates !== undefined &&
    !identifyResolved &&
    !photo.catId &&
    !failureOpen &&
    !albumSheetOpen;

  /**
   * What to call the cat in copy, when it may not have a name yet.
   *
   * `catNickname` is empty until the photograph is identified, and every sentence on this
   * screen that mentions the cat was written assuming it never would be — so they rendered as
   * "'s Cat Dex card" and "Your photo of ". That was true of *every* capture until this
   * release, because nothing called `identify`; it is now only true of one the player
   * declined to identify, which is a supported answer and therefore has to read properly.
   */
  const catName = photo.catNickname || 'this cat';

  return (
    <View style={styles.root}>
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
        accessibilityLabel={`Your photo of ${catName}`}
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
          The rank-up, back on the screen now that something awards it.

          Rendered only on the crossing, not on every capture: a badge that appears every
          time stops meaning anything, and the ramp is twelve tiers across a long time. The
          XP line below carries the ordinary case.
        */}
        {award?.rankUp ? (
          <View style={styles.rankUp}>
            <Text style={[text.eyebrow, styles.eyebrow]}>Rank up</Text>
            <Text style={[text.h2, { color: chrome.text }]}>{award.rankUp.title}</Text>
            <Text style={[text.caption, { color: arena.textMuted }]}>
              {`Photographer Rank ${award.rankUp.to}`}
            </Text>
          </View>
        ) : null}

        {/*
          One line, and what it says depends on what there is to say. The personal best is
          worth more than the XP and displaces it; the allowance is the fallback, and on Pro
          — where `remaining` is null — there is nothing to count down and nothing is drawn.
        */}
        {scored && award ? (
          <Text style={[text.caption, styles.xp]}>
            {award.personalBest
              ? `+${award.xpAwarded} XP · your best score yet`
              : `+${award.xpAwarded} XP`}
          </Text>
        ) : null}

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
            hint={`Use this photo on ${catName}'s card in your Cat Dex`}
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
            ? `${catName}'s card in your Cat Dex now shows this photo.`
            : `Save to Dex sets the cover photo on ${catName}'s Cat Dex card. It shows your highest-scoring shot of them until you choose one.`}
        </Text>

        {/*
          Above the fold, deliberately.

          Everything below `DetailToggle` is collapsed by default, and a control over who
          can see where the player was standing is not something to put behind a "show
          more". It is also the only switch on this screen that is already on when the
          screen opens, which is the other reason it has to be visible: a player has to be
          able to find and turn off a thing they never switched on.
        */}
        <MapShareRow
          value={onMap}
          busy={busy === 'map'}
          onToggle={() => void toggleMap()}
        />

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
        busy={busy === 'retake'}
        title="Retake this photo?"
        /*
         * What a retake actually costs, and this sentence has now been wrong in both
         * directions.
         *
         * It originally said the XP stays. Then deletion started revoking it and this was
         * rewritten to say it goes back. As of 2026-08-31 deletion revokes nothing again — the
         * score was paid for and the payment is not refunded, so keeping the reward is the only
         * version where the player is not charged twice — and the original sentence is true
         * once more.
         *
         * Which is the lesson worth leaving here: this copy is a claim about server behaviour,
         * and it has to be re-read whenever the delete path changes. It is not decoration.
         *
         * The score is only quoted when there is one. An unscored capture carries zeroes, so an
         * unguarded sentence promises to delete "its score of 0" — a real-looking verdict of
         * nought on a photograph nothing had judged.
         */
        body={
          photo.scoredAt
            ? `The photo and its score of ${photo.scores.total} are deleted, and the camera opens again. The ${photo.scores.total} XP it earned is yours to keep — the score was already spent.`
            : 'The photo is deleted and the camera opens again. It was never scored, so nothing is lost.'
        }
        confirmLabel="Delete and retake"
        cancelLabel="Keep this one"
        destructive
        context="arena"
      />

      {/*
        Rendered before the full-album sheet and shown instead of it when both apply.

        A capture can overflow the album *and* fail to score, and stacking two blocking
        sheets would be unreadable. This one goes first because it is the one with a retry
        in it — the scorer's bad moment passes, and a player who resolves the album first
        would have lost the chance to press the button while it was still worth pressing.
      */}
      {result.scoreError ? (
        <ScoreFailedSheet
          visible={failureOpen}
          failure={result.scoreError}
          busy={busy === 'score'}
          onRetry={() => void retryScore()}
          onRetake={() => setConfirmingRetake(true)}
          onDismiss={() => setFailureDismissed(true)}
        />
      ) : null}

      <AlbumFullSheet
        visible={albumSheetOpen}
        count={result.album.count}
        // The sheet is only raised when the album has a cap, so this cannot be null in
        // practice; the fallback keeps the type honest rather than asserting it away.
        limit={result.album.limit ?? 0}
        /*
         * The new photo is not one of the choices. It is what "discard" is for, and
         * offering it in the grid as well would give the same outcome two names — and
         * deleting it via the grid would leave the player on a reveal screen for a
         * photograph that no longer exists.
         */
        photos={albumPhotos.filter((p) => p.id !== photo.id)}
        busy={busy === 'album'}
        onDeleteExisting={(photoId) => void deleteExisting(photoId)}
        onDiscardNew={() => void discardNew()}
        onOpenShop={() => navigation.navigate('ProfileTab', { screen: 'Shop' })}
      />

      {/*
        Last of the three, and the only one a player may simply walk away from.

        It opens on an unscored capture too. Identifying does not wait for a score — the
        shortlist is weaker there, because there are no traits to rank on and proximity is all
        there is, but a photograph can be attached to a cat long before it is judged and
        making the player wait for an allowance to name their own cat would be backwards.
      */}
      <IdentifySheet
        visible={identifyOpen}
        candidates={result.candidates ?? []}
        busy={identifying}
        context="arena"
        onChoose={(choice) => void chooseCat(choice)}
        onDismiss={() => setIdentifyResolved(true)}
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
/**
 * The photograph is saved and has no score.
 *
 * Two failures reach this sheet and they are offered different ways out, because the same
 * offer would be a lie in one of them. A scorer that timed out will answer next time, so
 * trying again is the first thing on the list. A photograph with no cat in it will contain
 * no cat on the second look, so "try again" is not offered at all — putting it there would
 * invite a player to keep pressing a button that cannot work.
 *
 * Every branch says the photo is safe, because it is, and because the failure a player
 * fears here is having lost the shot.
 */
const ScoreFailedSheet = React.memo(function ScoreFailedSheet({
  visible,
  failure,
  busy,
  onRetry,
  onRetake,
  onDismiss,
}: {
  visible: boolean;
  failure: ScoreFailure;
  busy: boolean;
  onRetry: () => void;
  onRetake: () => void;
  onDismiss: () => void;
}) {
  /** The model looked and said no. Nothing about this photograph will change its mind. */
  const noCat = failure.reason === 'no_cat';
  /** The phone said no, before anything was sent. Cheap to be wrong about, so overridable. */
  const notDetected = failure.reason === 'not_detected';

  return (
    <BottomSheet
      visible={visible}
      onClose={onDismiss}
      title={
        notDetected
          ? 'We did not spot a cat'
          : noCat
            ? 'No cat in that one'
            : 'We could not score it'
      }
      context="arena"
    >
      <Text style={[text.body, { color: arena.textMuted }]}>{failure.message}</Text>

      {/*
        Said plainly and in both branches. A player who has just watched a score fail will
        assume the reveal was spent on nothing — it is the obvious reading — and the truth
        is the opposite, so it is worth a sentence rather than leaving them to notice an
        allowance that did not move.
      */}
      <Text style={[text.caption, styles.failNote]}>
        {notDetected
          ? 'Your photo is saved and no score was used. If there really is a cat in it, you can spend a score on it anyway.'
          : noCat
            ? 'Your photo is in your album and no score was used.'
            : 'Your photo is in your album and no score was used. You can try again now or from your album later.'}
      </Text>

      <View style={styles.failActions}>
        {/*
          Offered on two of the three, and absent from `no_cat` for a reason worth stating:
          that verdict came from the model, and buying it a second time returns the same
          sentence at the same price. `not_detected` came from a heuristic on the phone,
          which is wrong often enough that the player overruling it is a normal thing to do
          rather than a mistake to guard against — so it gets the button, labelled as the
          spend it is.
        */}
        {noCat ? null : (
          <Button
            label={notDetected ? 'Score it anyway' : 'Try scoring again'}
            onPress={onRetry}
            loading={busy}
            disabled={busy}
            context="arena"
            fullWidth
            accessibilityHint={
              notDetected
                ? 'Sends this photo to be scored, using one of your scores'
                : 'Asks for the score again. This does not use one of your scores.'
            }
          />
        )}

        <Button
          label="Delete and retake"
          variant={noCat ? 'primary' : 'ghost'}
          onPress={onRetake}
          disabled={busy}
          context="arena"
          fullWidth
          accessibilityHint="Deletes this photo and opens the camera again"
        />

        <Button
          label="Keep it as it is"
          variant="ghost"
          onPress={onDismiss}
          disabled={busy}
          context="arena"
          fullWidth
          accessibilityHint="Leaves the photo in your album without a score"
        />
      </View>
    </BottomSheet>
  );
});

/**
 * The map switch.
 *
 * Not a `MiniAction`, and the reason is structural rather than aesthetic: that component
 * disables itself once `done` is true, because all three things it holds — pin to the Dex,
 * save to the phone, retake — happen once and cannot be taken back. This one has to be
 * reversible, so it borrows the surface and none of the behaviour.
 *
 * The whole row is the hit target, not just the switch. A 30pt-wide control is a thing a
 * player misses on a moving bus, and the consequence of missing this particular one is
 * that they think they turned off a pin they did not.
 */
const MapShareRow = React.memo(function MapShareRow({
  value,
  busy,
  onToggle,
}: {
  value: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const Glyph = value ? MapPin : MapPinSimpleArea;

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: busy }}
      accessibilityLabel="Show as a pin on the map"
      accessibilityHint={
        value
          ? 'On. Other players see roughly where this cat was. Double tap to remove the pin.'
          : 'Off. This photo is not on the map. Double tap to add the pin.'
      }
      style={[styles.mapRow, busy && styles.miniBusy]}
    >
      <Glyph size={20} weight={value ? 'fill' : 'regular'} color={value ? marmalade[500] : arena.textMuted} />

      <View style={styles.mapRowText}>
        <Text style={[text.body, { color: arena.text }]}>
          {value ? 'On the map' : 'Off the map'}
        </Text>
        {/*
          The second line changes with the state instead of describing the switch, because
          the thing a player needs to know is different in each. On: what other people can
          see. Off: that the location is still recorded, which they would otherwise have to
          assume either way — and assuming wrong in that direction is the bad one.
        */}
        <Text style={[text.caption, styles.mapRowHint]}>
          {value
            ? 'Other players see roughly where this cat was, never the exact spot.'
            : 'No pin for anyone else. The location stays on the photo so your Cat Dex can still recognise this cat.'}
        </Text>
      </View>

      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={busy}
        trackColor={{ false: arena.sunken, true: marmalade[500] }}
        thumbColor={arena.text}
        // The row already announces itself as the switch; a second focus stop reading the
        // same state twice is noise for anyone moving through with a screen reader.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
});

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
  mapRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: arena.sunken,
  },
  mapRowText: {
    flex: 1,
    gap: 2,
  },
  mapRowHint: {
    color: arena.textMuted,
  },
  failNote: {
    marginTop: spacing.sm,
    color: arena.textFaint,
  },
  failActions: {
    marginTop: spacing.lg,
    gap: spacing.xs,
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
