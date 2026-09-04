import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CaretLeft,
  CaretRight,
  Cat as CatGlyph,
  ImageBroken,
  LockSimple,
  ShareNetwork,
} from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { photoApi } from '../../api/endpoints';
import { Badge, RarityBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { CircleButton } from '../../components/CircleButton';
import { ConfirmSheet } from '../../components/BottomSheet';
import { IdentifySheet } from '../../components/IdentifySheet';
import { EmptyState } from '../../components/EmptyState';
import { ScoreBreakdown } from '../../components/ScoreBreakdown';
import { Screen, SectionHeader, useStatusBarStyle } from '../../components/Screen';
import { SkeletonBlock } from '../../components/Skeleton';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { Avatar } from '../../components/Avatar';
import { ReactionBar } from '../../components/ReactionBar';
import type {
  CatCandidate,
  IdentifyChoice,
  PhotoDetail,
  Quotas,
  Reaction,
} from '../../models';
import {
  isPlaceholderId,
  placeholderPhotoById,
} from '../../constants/placeholders';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { usePawGift } from '../../hooks/usePawGift';
import { usePhotoReaction } from '../../hooks/usePhotoReaction';
import { useReactionStore } from '../../store/reactionStore';
import { COMMUNITY_CONFIG, PAW_CONFIG, communityLabel } from '../../constants/game';
import { usePawStore } from '../../store/pawStore';
import {
  chrome,
  layout,
  paper,
  marmalade,
  photoScrim,
  radii,
  rarity,
  spacing,
  spring,
  text,
} from '../../theme';
import { compactNumber, relativeTime } from '../../utils/format';

/**
 * Photo Detail (README section 5.3).
 *
 * Full-size photo, the score breakdown in its resting state, the caption, and the two
 * controls that change who can see it. Sharing and showcasing are the only actions here
 * with consequences outside the album, so they are grouped and labelled plainly rather
 * than buried in an icon row.
 */

/**
 * Typed against the route it needs rather than against one stack's whole param list.
 *
 * This screen is mounted in both the album and the home stacks — a photo opened from the
 * viral feed is the same screen as a photo opened from your album. Naming `AlbumStackParamList`
 * here would make it un-mountable anywhere else, and every navigation call it made would
 * be checked against routes that do not exist in the stack it is actually running in.
 */
/**
 * How far the title clears the sheet's top edge at its resting position.
 *
 * It used to be the sheet's own overlap onto the photo, back when the sheet was laid out in
 * the scroll flow. The sheet is positioned absolutely now, so the only thing that still needs
 * this number is the one element that has to sit above its edge without touching it.
 */
const SHEET_OVERLAP = 18;

type PhotoDetailParams = {
  PhotoDetail: { photoId: string };
  /** Both stacks that mount this screen register a CatProfile of their own. */
  CatProfile: { catId: string };
  /**
   * So does every one of them register a PublicProfile — home, map, challenges and profile.
   * Declared here rather than inherited because this screen is deliberately not typed
   * against any one stack's param list; see the note above.
   */
  PublicProfile: { userId: string };
};

type Props = NativeStackScreenProps<PhotoDetailParams, 'PhotoDetail'>;

export function PhotoDetailScreen({ route, navigation }: Props) {
  const { photoId } = route.params;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  /**
   * A little over half the viewport. Enough that a portrait crop is genuinely large,
   * while still leaving the score and the reaction bar visible without scrolling — the
   * two things a reader opens this screen to do.
   */
  const heroHeight = Math.round(windowHeight * 0.54);

  const cached = useAlbumStore((s) => s.byId(photoId));
  const myReactions = useReactionStore((s) => s.byPhotoId);
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const setCaption = useAlbumStore((s) => s.setCaption);
  const setShared = useAlbumStore((s) => s.setShared);
  const setSharedToMap = useAlbumStore((s) => s.setSharedToMap);
  const setShowcased = useAlbumStore((s) => s.setShowcased);
  const remove = useAlbumStore((s) => s.remove);
  const pinDexPhoto = useAlbumStore((s) => s.pinDexPhoto);
  const unpinDexPhoto = useAlbumStore((s) => s.unpinDexPhoto);
  const identifyPhoto = useAlbumStore((s) => s.identify);
  const upsertPhoto = useAlbumStore((s) => s.upsert);
  const cats = useAlbumStore((s) => s.cats);
  const loadCatDex = useAlbumStore((s) => s.loadCatDex);

  const [photo, setPhoto] = useState<PhotoDetail | null>(cached ?? null);
  const [missing, setMissing] = useState(false);
  const [caption, setCaptionText] = useState(cached?.caption ?? '');
  const [savingCaption, setSavingCaption] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinningDex, setPinningDex] = useState(false);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  /**
   * The shortlist, fetched only when the sheet is asked for.
   *
   * Not carried on the photo and not fetched on mount: a shortlist is a ranking against cats
   * seen near a place, it goes stale, and almost nobody who opens a photograph is about to
   * re-identify it. `null` is "not fetched yet", which is what draws the sheet's loading
   * state rather than an empty list.
   */
  const [candidates, setCandidates] = useState<CatCandidate[] | null>(null);
  const [revealing, setRevealing] = useState(false);
  /**
   * The reveal allowance, fetched only for a photo that has none.
   *
   * `null` while unknown, which is what makes the copy below say the plain thing rather than
   * promising a number it has not been told. The same endpoint the capture screen already
   * asks before opening the camera.
   */
  const [quotas, setQuotas] = useState<Quotas | null>(null);

  /* ----------------------------- the sheet ------------------------------- */

  /**
   * Three positions, and nothing in between once your finger is off it.
   *
   * The sheet used to settle anywhere the drag left it, which made a screen with no resting
   * state: the photograph was always half covered by an amount the player had to choose, and
   * choosing it was work nobody wanted to do. These are the three answers actually worth
   * having, and every release lands on exactly one of them.
   *
   *   full  — the detail, floor to ceiling, scrolling inside itself
   *   peek  — the score and its breakdown down to the bonus row, photograph above
   *   gone  — the photograph alone
   *
   * Measured as `translateY` from the full-screen position, so `full` is zero and the others
   * are how far down from it they sit.
   */
  const sheetTop = insets.top + spacing.xs;

  const snap = useMemo(
    () => ({
      full: 0,
      peek: heroHeight - sheetTop,
      gone: windowHeight - sheetTop,
    }),
    [heroHeight, sheetTop, windowHeight]
  );

  type Stage = 'full' | 'peek' | 'gone';

  const [stage, setStage] = useState<Stage>('peek');

  const sheetY = useSharedValue(snap.peek);
  const dragStart = useSharedValue(0);

  /**
   * Where the sheet's content is scrolled to, and whether the drag currently owns the sheet.
   *
   * These two are what let one continuous finger movement mean two different things without
   * the player having to aim at a particular part of the screen. See the gesture below.
   */
  const scrollY = useSharedValue(0);
  const dragOwnsSheet = useSharedValue(false);
  /** `translationY` at the instant the drag took the sheet over, so it does not jump. */
  const handoff = useSharedValue(0);

  /**
   * The scroll view's own gesture, named so the pan can agree to share with it.
   *
   * Declared as a gesture rather than reached for by ref: `simultaneousWithExternalGesture`
   * takes either, and a ref to an `Animated.ScrollView` does not satisfy the types on both
   * sides at once — reanimated hands back `AnimatedScrollView | null` and the gesture API
   * wants `ComponentType | undefined`. Composing two gestures says the same thing without a
   * cast in the middle of it.
   */
  const scrollGesture = useMemo(() => Gesture.Native(), []);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  /**
   * Sends the sheet to a named position from JS.
   *
   * The taps use this — the photograph, and the grabber itself. A drag is a fine way to move
   * a sheet and a poor way to be the *only* way: "much easier to dismiss" means a tap on the
   * picture does it too.
   */
  const goTo = useCallback(
    (next: Stage) => {
      sheetY.value = withSpring(snap[next], spring.soft);
      setStage(next);
    },
    [sheetY, snap]
  );

  /**
   * One drag, anywhere on the sheet.
   *
   * The grabber used to be the only thing that moved it, which meant a player who wanted the
   * full detail had to notice a 4pt bar and hit it — on a screen where the obvious instinct
   * is to push the content around. So the gesture spans the whole sheet and hands off to the
   * scroll view rather than competing with it:
   *
   *   below full  — the content cannot scroll (`scrollEnabled` is off), so every drag moves
   *                 the sheet. Up goes to full, down goes to gone.
   *   at full     — the content scrolls normally. The drag only claims the sheet when the
   *                 content is already at its top *and* the finger is heading down, which is
   *                 the one moment scrolling has nothing left to do.
   *
   * `handoff` records the translation at that instant. Without it the sheet would jump by
   * however far the finger had already travelled scrolling before the handover.
   */
  const pan = Gesture.Pan()
    .simultaneousWithExternalGesture(scrollGesture)
    .onBegin(() => {
      dragStart.value = sheetY.value;
      handoff.value = 0;
      // Anywhere but full, the sheet is the only thing a drag can move.
      dragOwnsSheet.value = sheetY.value > snap.full;
    })
    .onUpdate((event) => {
      if (!dragOwnsSheet.value) {
        const pullingDownAtTop = event.translationY > 0 && scrollY.value <= 0;
        if (!pullingDownAtTop) return;

        dragOwnsSheet.value = true;
        dragStart.value = sheetY.value;
        handoff.value = event.translationY;
      }

      const next = dragStart.value + (event.translationY - handoff.value);
      sheetY.value = Math.min(snap.gone, Math.max(snap.full, next));
    })
    .onEnd((event) => {
      // The scroll view had this one the whole way; there is nothing to snap.
      if (!dragOwnsSheet.value) return;
      dragOwnsSheet.value = false;

      /*
       * Where the flick was heading, not where it stopped.
       *
       * Projecting the release velocity forward is what makes a short fast swipe do the
       * obvious thing. Snapping on position alone reads as the sheet arguing: you throw it
       * downward, it has not passed the midpoint, and it climbs back up over your finger.
       */
      const projected = sheetY.value + event.velocityY * 0.12;

      const target = (['full', 'peek', 'gone'] as Stage[]).reduce((best, name) =>
        Math.abs(snap[name] - projected) < Math.abs(snap[best] - projected) ? name : best
      );

      sheetY.value = withSpring(snap[target], spring.soft);
      runOnJS(setStage)(target);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  /**
   * The title fades out as the sheet swallows it.
   *
   * It sits directly above the sheet's top edge and travels with it, so on the way to full
   * screen it would slide up under the notch and sit behind the status bar. Fading it over
   * the last stretch costs nothing and means it never collides with the clock.
   */
  const heroFootStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, sheetY.value / (snap.peek || 1))),
  }));

  const dexEntry = photo ? cats.find((c) => c.id === photo.catId) : undefined;
  /** Pinned by hand to *this* photo — not merely the shot that happens to be winning. */
  const isDexPhoto = Boolean(
    photo && dexEntry?.bestPhotoPinned && dexEntry.bestPhotoId === photo.id
  );

  /*
   * The Dex row needs the cat's entry to know whether this photo is its cover, and this
   * screen is reachable from the feed without the Dex ever having been opened. One fetch
   * when the list is empty is cheaper than a row that shows the wrong state.
   */
  useEffect(() => {
    if (cats.length === 0) void loadCatDex();
    // Deliberately mount-only: refetching whenever `cats` changes would loop on an
    // account with no cats yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    /*
     * A design placeholder has no row behind it, so there is nothing to fetch.
     *
     * Without this the one thing a placeholder feed cannot do is be opened: every tap on a
     * fake card would 404 into "This photo has moved on", and the half of the design with
     * the score, the breakdown and the author on it would be unreachable. Read straight out
     * of `constants/placeholders` instead. Nothing below this line runs.
     */
    if (isPlaceholderId(photoId)) {
      const stand = placeholderPhotoById(photoId);
      if (stand) {
        setPhoto({ ...stand, myReaction: useReactionStore.getState().get(stand.id) });
        setCaptionText(stand.caption ?? '');
      } else {
        setMissing(true);
      }
      return;
    }

    // Refetch even when cached: reactions and challenge status change server-side, and
    // the cached copy is whatever the album last synced.
    photoApi
      .detail(photoId)
      .then((result) => {
        // The detail payload is cacheable and so carries no viewer — this device's own
        // reaction comes from the store, same as it does on the feed. See reactionStore.
        setPhoto({
          ...result.photo,
          myReaction: useReactionStore.getState().get(result.photo.id),
        });
        setCaptionText(result.photo.caption ?? '');
      })
      .catch(() => {
        if (!cached) setMissing(true);
      });
  }, [cached, photoId]);

  /*
   * Asked for only by a photograph that has no score.
   *
   * Every other visit to this screen has no use for the number, and the album is the screen
   * a player opens most — putting an allowance request on every one of them would be a round
   * trip per photo tap to answer a question almost nobody is asking.
   */
  useEffect(() => {
    if (!photo || photo.scoredAt !== null) return;

    let alive = true;
    photoApi
      .allowance()
      .then((result) => {
        if (alive) setQuotas(result);
      })
      .catch(() => {
        // The button below does not depend on this; it only makes the copy vaguer.
      });

    return () => {
      alive = false;
    };
  }, [photo]);

  const saveCaption = useCallback(async () => {
    if (!photo) return;

    setSavingCaption(true);
    try {
      await setCaption(photo.id, caption.trim());
      setPhoto({ ...photo, caption: caption.trim() });
      showToast('Caption saved', 'success');
    } catch {
      showToast('We could not save that caption.', 'error');
    } finally {
      setSavingCaption(false);
    }
  }, [caption, photo, setCaption]);

  const toggleShared = useCallback(async () => {
    if (!photo) return;
    const next = !photo.sharedToFeed;

    setPhoto({ ...photo, sharedToFeed: next });
    try {
      await setShared(photo.id, next);
    } catch {
      setPhoto({ ...photo, sharedToFeed: !next });
      showToast('We could not change that. Try again.', 'error');
    }
  }, [photo, setShared]);

  const toggleSharedToMap = useCallback(async () => {
    if (!photo) return;
    const next = !photo.sharedToMap;

    setPhoto({ ...photo, sharedToMap: next });
    try {
      await setSharedToMap(photo.id, next);
    } catch {
      setPhoto({ ...photo, sharedToMap: !next });
      showToast('We could not change that. Try again.', 'error');
    }
  }, [photo, setSharedToMap]);

  const toggleShowcased = useCallback(async () => {
    if (!photo) return;

    try {
      await setShowcased(photo.id, !photo.showcased);
      setPhoto({ ...photo, showcased: !photo.showcased });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'We could not change that.',
        'error'
      );
    }
  }, [photo, setShowcased]);

  /**
   * Puts this photo on the cat's Dex card, or hands the card back to the top scorer.
   *
   * Every cat you photograph is already in the Dex — that happens at capture. What this
   * changes is which of your photos the card shows for it, which is otherwise always your
   * highest-scoring one. Reversible in both directions, because "which picture looks most
   * like this cat" is a matter of taste and taste changes.
   */
  const toggleDexPhoto = useCallback(async () => {
    if (!photo) return;

    setPinningDex(true);
    try {
      if (isDexPhoto) {
        await unpinDexPhoto(photo.catId);
        showToast(
          `${photo.catNickname}'s card is back to your highest-scoring shot.`,
          'success'
        );
      } else {
        await pinDexPhoto(photo.catId, photo.id);
        showToast(`This photo is now on ${photo.catNickname}'s Dex card.`, 'success');
      }
    } catch {
      showToast('We could not change that. Try again.', 'error');
    } finally {
      setPinningDex(false);
    }
  }, [isDexPhoto, photo, pinDexPhoto, unpinDexPhoto]);

  /**
   * Opens the shortlist for this photograph.
   *
   * The sheet is raised first and the request runs behind it, so the player sees the thing
   * they tapped rather than a button that appears to do nothing for a second. A failed fetch
   * leaves `candidates` empty, which lands them on the naming step — still a useful answer,
   * because "none of these" was always one of the two things this sheet is for.
   */
  const openIdentify = useCallback(async () => {
    if (!photo) return;

    setIdentifyOpen(true);

    try {
      const { candidates: found } = await photoApi.candidates(photo.id);
      setCandidates(found);
    } catch {
      setCandidates([]);
    }
  }, [photo]);

  /**
   * Records the player's answer, first time or correcting one.
   *
   * Re-identifying is deliberately allowed: somebody who picked the wrong cat should be able
   * to say so, and the server treats it as a leave-and-join. `releasedCatId` on the response
   * is why the store refetches the Dex rather than adjusting the old entry — if this was the
   * only photograph the player had of that cat, the entry is gone entirely.
   */
  const chooseCat = useCallback(
    async (choice: IdentifyChoice) => {
      if (!photo) return;

      setIdentifying(true);
      try {
        const identification = await identifyPhoto(photo.id, choice);

        setPhoto(identification.photo);
        setIdentifyOpen(false);
        setCandidates(null);

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
    [identifyPhoto, photo]
  );

  /**
   * Spends an allowance on a photograph that was stored without a score.
   *
   * The endpoint answers with the same shape a capture does, failures included: a reveal that
   * could not reach the scorer is a 200 carrying `scoreError`, not a rejected request. Nothing
   * was charged in that case — the ledger row is written after a score lands, never before —
   * so it is a retry rather than a loss and the copy says so.
   *
   * The out-of-allowance refusal is the other outcome, and it arrives as a thrown error with
   * the server's own message, which is written for a player to read.
   */
  /**
   * Whose photograph this is.
   *
   * Derived up here rather than after the loading guard, because the reveal path below reads
   * it — and it now decides more than which controls are drawn: it decides which *currency*
   * a reveal is paid in. `photo` is null while loading, and a null photo is nobody's.
   */
  const isMine = photo !== null && viewerId !== null && photo.ownerId === viewerId;

  /**
   * The wallet, for the reveal button's label.
   *
   * Read here rather than passed down because the button is the only thing on this screen
   * that spends, and threading a balance through the whole render for one label would be
   * more machinery than the fact is worth.
   */
  const pawWallet = usePawStore((s) => s.wallet);

  /**
   * Whether revealing this photograph costs paws rather than a free score.
   *
   * Two ways to end up here and they are deliberately the same branch, because the server
   * makes the same decision in `fundingFor`:
   *
   *   - it is **not yours** — the free allowance is for your own album, always, which is what
   *     stops a reveal on a stranger's photo silently spending a score you were saving;
   *   - it is yours and the allowance is **gone**.
   *
   * `quotas.remaining === null` is Pro, which is unlimited and therefore never pays paws for
   * its own work. It still pays for somebody else's, because that is not what Pro bought.
   */
  const payWithPaws = !isMine || (quotas?.remaining !== null && (quotas?.remaining ?? 0) <= 0);

  const revealScore = useCallback(async () => {
    if (!photo) return;

    setRevealing(true);
    try {
      const result = await photoApi.reveal(photo.id);

      /*
       * Only your own photographs go into the album store.
       *
       * Revealing somebody else's is now a thing a player can pay to do, and the reply carries
       * their photograph — writing it here would file a stranger's picture into this device's
       * album cache, where the grid and the "1 of 200" count would both start counting it.
       */
      if (isMine) await upsertPhoto(result.photo);

      setPhoto(result.photo);
      setQuotas((current) => (current ? { ...current, ...result.allowance } : current));

      // A paw-funded reveal moved the wallet and the reply does not carry it, so the balance
      // is re-read rather than guessed. Cheap, and this is not a per-scroll action.
      if (payWithPaws) void usePawStore.getState().refresh();

      if (result.scored) {
        showToast(`Scored ${result.photo.scores.total}.`, 'success');
      } else {
        showToast(
          result.scoreError?.message ?? 'That photo could not be scored right now.',
          result.scoreError?.reason === 'no_cat' ? 'neutral' : 'error'
        );
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'We could not reach the scorer.',
        'error'
      );
    } finally {
      setRevealing(false);
    }
  }, [isMine, payWithPaws, photo, upsertPhoto]);

  const confirmDelete = useCallback(async () => {
    if (!photo) return;

    setDeleting(true);
    try {
      await remove(photo.id);
      navigation.goBack();
    } catch {
      showToast('We could not delete that photo.', 'error');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [navigation, photo, remove]);

  /**
   * Reacting from the detail screen. The rules live in `usePhotoReaction`, shared with
   * the feed — a second hand-rolled optimistic update is a second place for the counts
   * to drift.
   */
  const patchPhoto = useCallback(
    (photoId: string, apply: (p: PhotoDetail) => PhotoDetail) => {
      setPhoto((current) => (current && current.id === photoId ? apply(current) : current));
    },
    []
  );

  const reactTo = usePhotoReaction(patchPhoto);
  const givePawTo = usePawGift(patchPhoto);

  const react = useCallback(
    (reaction: Reaction) => {
      if (photo) reactTo(photo, reaction);
    },
    [photo, reactTo]
  );

  const share = useCallback(async () => {
    if (!photo) return;

    try {
      await Share.share({
        message: photo.caption || photo.badges[0] || 'A cat, caught mid-moment.',
        url: photo.imageUrl || undefined,
      });
    } catch {
      showToast('We could not open the share sheet.', 'error');
    }
  }, [photo]);

  /*
   * The loaded screen is a photograph running under the notch, so the clock inverts to stay
   * readable. The missing and loading states below are ordinary paper screens, and they get
   * the paper style from here rather than from `Screen` — a parent's effect runs after its
   * child's, so this component has the last word either way and has to say the right thing.
   */
  useStatusBarStyle(!photo || missing ? 'dark' : 'light');

  if (missing) {
    return (
      <Screen>
        <EmptyState
          title="This photo has moved on"
          body="It may have been deleted from another device. Your other photos are unaffected."
          Glyph={ImageBroken}
          actionLabel="Go back"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  if (!photo) {
    return (
      <Screen scroll>
        <SkeletonBlock width="100%" height={320} radius={radii.xxl} />
        <SkeletonBlock width="55%" height={22} style={styles.gap} />
        <SkeletonBlock width="100%" height={180} radius={radii.xl} style={styles.gap} />
      </Screen>
    );
  }

  /** The one field that says whether `scores`, `tier` and `badges` mean anything. */
  const scored = photo.scoredAt !== null;

  return (
    <View style={styles.root}>

      {/*
        The photograph, fixed and full screen, behind everything else.

        It used to be the first child of the scroll content at 54% height, which meant the
        picture could never be seen whole: the only way to make the sheet go away was to
        scroll it up, and scrolling up takes the photo with it. Pinning it here is what gives
        the sheet something to slide *off*.
      */}
      <View style={styles.photoLayer}>
        <Image
          source={photo.imageUrl || undefined}
          contentFit="cover"
          transition={220}
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityLabel={`Photo of ${photo.catNickname}`}
        />
        {!photo.imageUrl ? (
          <View style={styles.noPhoto}>
            <Text style={[text.caption, { color: paper.textFaint }]}>No image</Text>
          </View>
        ) : null}
      </View>

      {/*
        The photograph is the other control.

        Tapping it drops the sheet away, and tapping it again brings it back — the same
        gesture in both directions and no aiming required. A grabber alone made dismissing a
        thing you had to be precise about, on the one screen whose whole point is the picture.
      */}
      <Pressable
        style={[styles.photoTap, { height: stage === 'gone' ? windowHeight : heroHeight }]}
        onPress={() => goTo(stage === 'gone' ? 'peek' : 'gone')}
        accessibilityRole="button"
        accessibilityLabel={
          stage === 'gone' ? 'Show the photo details' : 'Hide the details and show the photo'
        }
      />

      {/*
        The scrim and the title travel with the sheet, so they leave when it does.

        Both belong to the sheet rather than to the photograph: the scrim exists to make the
        title legible, and a darkened band with no text on it is just a dirty mark on a
        picture somebody asked to see clean.
      */}
      <Animated.View
        style={[styles.heroLayer, { height: heroHeight }, sheetStyle]}
        pointerEvents="none"
      >
        <LinearGradient
          style={styles.heroScrim}
          colors={['rgba(0, 0, 0, 0)', photoScrim.posterTop, photoScrim.posterBottom]}
          locations={[0, 0.45, 1]}
        />

        <Animated.View style={[styles.heroFoot, heroFootStyle]}>
          <Text style={[text.h1, styles.heroTitle]} numberOfLines={1}>
            {photo.catNickname || 'Not identified yet'}
          </Text>
          {/* Withheld with the rest of the score — `tier` is a filled-in default until
              `scoredAt` is set, and 'Common' is not a verdict anybody reached. */}
          {scored ? <RarityBadge rarity={photo.tier} size="lg" /> : null}
        </Animated.View>
      </Animated.View>

      {/*
        The sheet itself: always full height, moved rather than resized.

        Laying it out at its tallest and translating between the three positions is what lets
        the same content serve all of them — the alternative is animating `height`, which
        relayouts every child on every frame of a drag.
      */}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.sheet,
            { top: sheetTop, height: windowHeight - sheetTop },
            sheetStyle,
          ]}
          accessibilityHint="Swipe up for the full details, down to see the photo"
        >
          <View style={styles.grabberHit}>
            <View style={styles.grabber} />
          </View>

        <GestureDetector gesture={scrollGesture}>
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.scrollView}
          contentContainerStyle={styles.scroll}
          /*
           * Only at full height. At `peek` the sheet is showing a deliberate slice — the
           * score and its breakdown — and letting the content scroll inside that slice would
           * mean two ways to move the same thing, one of which leaves the sheet at a size
           * that matches nothing.
           */
          scrollEnabled={stage === 'full'}
          bounces={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/*
            The score, or the way to get one.

            This screen drew `scores.total` unconditionally, and an unscored photo carries
            zeroes — so every capture beyond the day's allowance was shown a confident "0 /
            100 overall" and a breakdown of four zeroes. Meanwhile the reveal screen's own
            copy told the player to "open it from your album to reveal the score", and there
            was no control here to do it with. Both halves of that are below.
          */}
          {/*
            Whose photograph this is, above the number.

            Present exactly when the reader is not the owner — `GET /photos/:id` sends the
            feed card to everyone else, and that is the serialization carrying an author. It
            leads the sheet because a photo reached from the feed raises "who took this"
            before it raises "what did it score", and until now the answer was nowhere on
            the screen: the only route to a photographer's other work was to go back to the
            feed and find another of their cards.
          */}
          {photo.author && !isMine ? (
            <Pressable
              onPress={() =>
                navigation.navigate('PublicProfile', { userId: photo.author!.id })
              }
              accessibilityRole="button"
              accessibilityLabel={`${photo.author.username}'s profile`}
              style={styles.authorRow}
            >
              <Avatar
                uri={photo.author.avatarUrl}
                name={photo.author.username}
                size={30}
              />
              <Text style={[text.h3, styles.authorName]} numberOfLines={1}>
                {photo.author.username}
              </Text>
              <CaretRight size={14} weight="bold" color={paper.textFaint} />
            </Pressable>
          ) : null}

          {scored ? (
            <>
              {/*
                The score and the tier, and no denominator.

                "/ 100 overall" was answering a question nobody asks — the scale is the same
                on every photograph in the product, so restating it on each one spends a line
                to say nothing. The tier is what the number actually means, it is the word
                the rest of the app ranks and filters by, and it is the half a player repeats
                out loud. So: "57 Common", which is how they would say it.
              */}
              <View style={styles.scoreRow}>
                <Text style={[text.statLg, { color: paper.text }]}>{photo.scores.total}</Text>
                <Text style={[text.h2, { color: rarity[photo.tier].base }]}>
                  {photo.tier}
                </Text>
              </View>

              <ScoreBreakdown
                scores={photo.scores}
                pose={photo.pose}
                tier={photo.tier}
                badges={photo.badges}
                showTotal={false}
                style={styles.breakdown}
              />

              {/*
                Who paid for this score, when it was not the photographer.

                Under the breakdown rather than over it, and set in caption type: the number is
                what the screen is about and the credit is a footnote to it. It is drawn only
                when the server sends one — `revealedBy` is null for a photographer's own
                reveal, so this never says "Unlocked by you" and never appears on the thousands
                of photographs nobody else paid for.

                Pressable, because a credit that names somebody and cannot be followed is a
                dead end — and the person who spent paws on your photograph is exactly the
                person you might want to look at.
              */}
              {photo.revealedBy ? (
                <Pressable
                  onPress={() =>
                    navigation.navigate('PublicProfile', { userId: photo.revealedBy!.id })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Score unlocked by ${photo.revealedBy.username}. Opens their profile.`}
                  style={styles.revealCredit}
                >
                  <Text style={[text.caption, { color: paper.textFaint }]}>
                    Unlocked by{' '}
                    <Text style={[text.caption, { color: marmalade[600] }]}>
                      {photo.revealedBy.username}
                    </Text>
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <View style={styles.unscored}>
              <View style={styles.unscoredHead}>
                <LockSimple size={20} weight="fill" color={paper.textMuted} />
                <Text style={[text.h3, { color: paper.text }]}>Not scored yet</Text>
              </View>

              <Text style={[text.body, { color: paper.textMuted }]}>
                {isMine
                  ? revealHint(quotas)
                  : `The photographer has not revealed this score yet. You can have it judged for ${PAW_CONFIG.revealCost} paws — the score goes to them, and to everyone.`}
              </Text>

              {/*
                Offered whatever the allowance and the wallet say, and refused by the server
                rather than by a disabled button. Both of this device's numbers are snapshots:
                the allowance turns over on a rolling window, and the wallet moves whenever
                somebody else gives this player a paw. Greying the button out would mean a
                player who was paw'd thirty seconds ago is told they cannot afford something
                they can, by a screen that has not asked since.

                It is now offered on **somebody else's** photograph too, which it never used to
                be. The old note said a reveal there would spend *your allowance* on *their*
                row — that is still true and is still refused. What changed is that paws can
                pay for it instead, and the allowance is not consulted on that branch at all.
              */}
              <Button
                label={
                  payWithPaws
                    ? `Reveal for ${PAW_CONFIG.revealCost} 🐾`
                    : 'Reveal the score'
                }
                onPress={() => void revealScore()}
                loading={revealing}
                disabled={revealing}
                fullWidth
                accessibilityHint={
                  payWithPaws
                    ? `Spends ${PAW_CONFIG.revealCost} paws from your wallet to have this photo judged`
                    : 'Uses one of your free scores to have this photo judged'
                }
              />

              {/*
                Said once, under the button, and only when paws are what is being spent.

                The free path needs no explanation — `revealHint` above has already said how
                many scores are left. This line exists because spending currency on a tap
                should never be a surprise, and because "from your wallet" is the second half
                of the lesson the gift toast starts.
              */}
              {payWithPaws ? (
                <Text style={[text.caption, { color: paper.textFaint }]}>
                  {`From your wallet — ${compactNumber(pawWallet)} paw${pawWallet === 1 ? '' : 's'} left. Your free scores are for your own photos.`}
                </Text>
              ) : null}
            </View>
          )}

          {/*
            The viewer's own reaction is read from the store rather than from `photo`,
            because the store is where it actually lives — the detail payload is shared
            and carries no viewer. Reading it from one place is what stops the button and
            the feed disagreeing after a round trip.
          */}
          <ReactionBar
            photoId={photo.id}
            reactions={photo.reactions}
            myReaction={myReactions[photo.id] ?? null}
            onReact={react}
            pawCount={photo.pawCount}
            onGivePaw={() => givePawTo(photo)}
            disabled={isMine}
            size="lg"
            style={styles.votes}
          />

          {isMine ? (
            <Text style={[text.caption, styles.ownNote]}>
              Your own photo — reactions are other players' verdict, not yours.
            </Text>
          ) : null}

          {(photo.submittedToChallengeId || photo.showcased) && (
            <View style={styles.badges}>
              {photo.submittedToChallengeId ? (
                <Badge label="Challenge entry" tone="accent" />
              ) : null}
              {photo.showcased ? <Badge label="Showcased" tone="neutral" /> : null}
            </View>
          )}

          {/*
            Two rows, and which one shows is whether anybody has said what this cat is.

            An unidentified photograph used to render the Dex row anyway, with an empty
            `catNickname` — so it read "'s Dex" and led to a cat profile for the empty string.
            Nothing in the app called `identify`, so that was every photograph in the album.

            Hidden entirely on somebody else's photograph, and for the same reason. A Dex is
            one player's private record: `catNickname` is the *reader's* name for the cat, so
            on a stranger's photo it is always empty and this drew the exact "'s Dex" bug
            described above. Identifying it would be worse still — it would file another
            player's photograph into your Dex.
          */}
          {!isMine ? null : photo.catId ? (
            <Pressable
              onPress={() => navigation.navigate('CatProfile', { catId: photo.catId })}
              accessibilityRole="button"
              accessibilityLabel={`Open ${photo.catNickname}'s Dex entry`}
              style={styles.dexRow}
            >
              <View style={styles.dexThumb}>
                <Image
                  source={photo.imageUrl || undefined}
                  contentFit="cover"
                  transition={160}
                  style={StyleSheet.absoluteFill}
                  accessible={false}
                />
              </View>
              <View style={styles.rowBody}>
                <Text style={[text.h3, { color: paper.text }]} numberOfLines={1}>
                  {`${photo.catNickname}'s Dex`}
                </Text>
                <Text style={[text.caption, { color: paper.textFaint }]} numberOfLines={1}>
                  {`Captured ${relativeTime(photo.capturedAt)} · ${photo.tier}`}
                </Text>
              </View>
              <CaretRight size={16} color={paper.textFaint} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void openIdentify()}
              accessibilityRole="button"
              accessibilityLabel="Say which cat this is"
              accessibilityHint="Opens a list of cats seen nearby that look like this one"
              style={styles.dexRow}
            >
              <View style={[styles.dexThumb, styles.dexThumbEmpty]}>
                <CatGlyph size={22} color={paper.textFaint} weight="duotone" />
              </View>
              <View style={styles.rowBody}>
                <Text style={[text.h3, { color: paper.text }]} numberOfLines={1}>
                  Which cat is this?
                </Text>
                <Text style={[text.caption, { color: paper.textFaint }]} numberOfLines={2}>
                  Name them and they go in your Cat Dex.
                </Text>
              </View>
              <CaretRight size={16} color={paper.textFaint} />
            </Pressable>
          )}

          {/*
            The correction, and only offered once there is something to correct.

            Quiet on purpose. Getting the cat wrong is uncommon and fixing it is not what
            anybody opened this screen to do, so it sits under the Dex row as a text button
            rather than competing with it.
          */}
          {photo.catId && isMine ? (
            <Button
              label="Not this cat?"
              variant="ghost"
              onPress={() => void openIdentify()}
              style={styles.notThisCat}
              accessibilityHint={`Moves this photo off ${photo.catNickname} and onto another cat`}
            />
          ) : null}

          {/*
            The second scoring layer. Deliberately a separate block from the breakdown
            above, because the two are different opinions and the gap between them is the
            point — a photo the app rated modestly that people loved is the interesting
            outcome.
          */}
          <SectionHeader
            title="What people thought"
            description="Reactions from other players. This is what decides your rank."
          />

          <Card padding={spacing.lg}>
            {!photo.sharedToFeed ? (
              <Text style={[text.body, { color: paper.textMuted }]}>
                This photo is private, so nobody has seen it. Share it to the feed and
                reactions start counting toward your rank.
              </Text>
            ) : (
              <>
                <View style={styles.communityRow}>
                  <View>
                    <Text style={[text.caption, { color: paper.textMuted }]}>Reactions</Text>
                    <Text style={[text.statMd, { color: paper.text }]}>{photo.voteCount}</Text>
                  </View>
                  <View>
                    <Text style={[text.caption, { color: paper.textMuted }]}>Seen by</Text>
                    <Text style={[text.statMd, { color: paper.text }]}>{photo.viewCount}</Text>
                  </View>
                  <View>
                    <Text style={[text.caption, { color: paper.textMuted }]}>Reacted</Text>
                    <Text style={[text.statMd, { color: paper.text }]}>
                      {communityLabel(photo.communityScore, photo.viewCount) ?? '—'}
                    </Text>
                  </View>
                </View>

                <Text style={[text.caption, styles.communityNote]}>
                  {communityLabel(photo.communityScore, photo.viewCount)
                    ? 'Ranked on the share of viewers who reacted, so a smaller audience is not a disadvantage.'
                    : `Not enough views yet for a meaningful figure — it settles after about ${COMMUNITY_CONFIG.minViewsForConfidence} people have seen it.`}
                </Text>
              </>
            )}
          </Card>

          {/*
            The caption is editable by exactly one person and readable by everyone.

            A stranger gets the words without the field: an editor on somebody else's photo
            offered to rewrite their caption, and the PATCH behind it is owner-only, so the
            only possible outcome of using it was a 404 over a change the player had already
            watched themselves type.
          */}
          {isMine ? (
            <>
              <SectionHeader title="Caption" />
              <TextField
                label="Caption"
                value={caption}
                onChangeText={setCaptionText}
                placeholder="Say something about this one"
                maxLength={140}
                multiline
              />
              {caption.trim() !== (photo.caption ?? '') ? (
                <Button
                  label="Save caption"
                  variant="secondary"
                  onPress={() => void saveCaption()}
                  loading={savingCaption}
                  style={styles.saveCaption}
                />
              ) : null}
            </>
          ) : photo.caption ? (
            <>
              <SectionHeader title="Caption" />
              <Text style={[text.body, { color: paper.textMuted }]}>{photo.caption}</Text>
            </>
          ) : null}

          {/*
            Everything from here down changes the photograph, so none of it is drawn unless
            the photograph is yours.

            All three of these toggles, the Dex pin and the delete below PATCH or DELETE an
            owner-only route. Rendering them for a reader who cannot use them offered a set
            of switches whose only possible response was an error — and "Delete photo" sitting
            under a stranger's picture reads as a claim about what this screen can do, which
            is the one thing a destructive control must never get wrong.
          */}
          {isMine ? (
            <>
            <SectionHeader
              title="Sharing"
              /*
                "Not in the feed" rather than "not visible to anyone".

                Photos live in a public storage bucket at an unguessable address: nothing
                lists them, nothing links them, and the path cannot be walked — but a URL
                that escaped would still open. The toggle below controls discoverability,
                which is what it has always actually controlled, so that is what it says.
              */
              description="Your album stays out of the feed. Nothing here is shown to other players until you share it."
            />

            <DividedGroup>
              <ToggleRow
                label="Show in the community feed"
                hint="Other players can see and react to this photo."
                value={photo.sharedToFeed}
                onChange={() => void toggleShared()}
              />
              <ToggleRow
                label="Pin to my public profile"
                hint="Appears in your showcase, up to six photos."
                value={photo.showcased}
                onChange={() => void toggleShowcased()}
              />
              {/*
                The one switch here that starts on, and the hint says what turning it off
                does and does not do. "Off the map" is a promise about other players, not
                about the record: the coordinates stay so the Cat Dex can still recognise
                this cat next time, which is a thing a player would reasonably assume the
                switch also erased.
              */}
              <ToggleRow
                label="Show as a pin on the map"
                hint="Other players see roughly where this cat was — never the exact spot. Turning this off removes the pin; the photo keeps its location for Cat Dex matching."
                value={photo.sharedToMap}
                onChange={() => void toggleSharedToMap()}
              />
            </DividedGroup>

            {/*
              The Dex gets its own section and its own paragraph because it is the one
              control here whose effect is somewhere else in the app. "Save to Dex" on the
              reveal screen is this same switch, and a player who pressed it there and
              wondered what moved should find the answer written out here.

              Hidden entirely until the photograph has a cat. A card belongs to an animal, and
              with no `catId` this drew "Use as 's Dex photo" and would have pinned against an
              empty id. Declining to identify is a supported answer now, so this is a state
              that will really happen rather than one that only existed before the sheet did.
            */}
            {photo.catId ? (
              <>
            <SectionHeader
              title="Cat Dex"
              description={`Your Dex keeps one card per cat. The card shows your highest-scoring photo of that cat unless you choose a different one — it does not change the cat's score, tier or Dex entry, only the picture on the card.`}
            />

            <DividedGroup>
              <ToggleRow
                label={`Use as ${photo.catNickname}'s Dex photo`}
                hint={
                  isDexPhoto
                    ? `${photo.catNickname}'s card shows this photo because you chose it.`
                    : dexEntry?.bestPhotoId === photo.id
                      ? `This is already on the card as your best shot of ${photo.catNickname}. Turn this on to keep it there even after a higher score.`
                      : `The card currently shows your highest-scoring shot of ${photo.catNickname}.`
                }
                value={isDexPhoto}
                disabled={pinningDex}
                onChange={() => void toggleDexPhoto()}
              />
            </DividedGroup>
              </>
            ) : null}

            </>
          ) : null}

          {/*
            Sharing the link is not an owner's privilege — this opens the OS share sheet on a
            photograph that is already published to the feed, which is the same act as sending
            somebody a link to it. Deleting is, and it is the half that is gated.
          */}
          <View style={styles.actions}>
            <Button label="Share this shot" onPress={() => void share()} trailingIcon />
            {isMine ? (
              <Button
                label="Delete photo"
                variant="ghost"
                destructive
                onPress={() => setConfirmingDelete(true)}
              />
            ) : null}
          </View>
        </Animated.ScrollView>
        </GestureDetector>
        </Animated.View>
      </GestureDetector>

      {/*
        Fixed, outside the sliding sheet — they used to sit inside the hero and scroll away
        with it, so a scrolled-down photo had no exit but the OS back gesture.

        Left and right gutters, so neither of them ever meets the grabber in the middle.

        The context follows what is behind them. At full height these two discs are sitting
        on the sheet's own paper, and a light glyph blurred over a light surface is a button
        you have to hunt for — which is the wrong thing to make hard to find, since this is
        the only way off the screen.
      */}
      <View style={[styles.heroChrome, { top: insets.top + spacing.xs }]}>
        <CircleButton
          Glyph={CaretLeft}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          context={stage === 'full' ? 'paper' : 'arena'}
        />
        <CircleButton
          Glyph={ShareNetwork}
          onPress={() => void share()}
          accessibilityLabel="Share this shot"
          glyphSize={17}
          context={stage === 'full' ? 'paper' : 'arena'}
        />
      </View>

      <ConfirmSheet
        visible={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void confirmDelete()}
        title="Delete this photo?"
        body="This cannot be undone. If it is your best shot of this cat, your next-best takes its place in the Cat Dex."
        confirmLabel="Delete"
        busy={deleting}
        destructive
      />

      {/*
        Mounted only while it is open, unlike the confirm sheet above.

        The shortlist is fetched when the sheet is asked for, so keeping it mounted would keep
        a stale ranking and a half-typed name alive between visits. `candidates ?? []` is the
        in-flight state: an empty list opens on the naming step, which is where a player who
        genuinely has no nearby cats belongs anyway.
      */}
      {identifyOpen ? (
        <IdentifySheet
          visible
          candidates={candidates ?? []}
          busy={identifying || candidates === null}
          title={photo.catId ? `Not ${photo.catNickname}?` : undefined}
          onChoose={(choice) => void chooseCat(choice)}
          onDismiss={() => {
            setIdentifyOpen(false);
            setCandidates(null);
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * What to say above the reveal button.
 *
 * Three states and they are genuinely different promises. Unknown says the plain fact and
 * nothing else. Slots remaining names the count, because "2 left" is what makes pressing it
 * feel affordable. None left names a time rather than "tomorrow" — the window rolls, so there
 * is no midnight to point at, and the clock that matters is the server's.
 */
function revealHint(quotas: Quotas | null): string {
  if (!quotas || quotas.remaining === null) {
    return 'This photo is saved but has not been judged yet. Reveal it whenever you like.';
  }

  if (quotas.remaining > 0) {
    return quotas.remaining === 1
      ? 'You have 1 score left today. Spend it on this photo?'
      : `You have ${quotas.remaining} scores left today. Spend one on this photo?`;
  }

  if (!quotas.resetsAt) {
    return 'You have used today\'s scores. This photo keeps its place until one frees up.';
  }

  const time = new Date(quotas.resetsAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `You have used today's scores. Your next one unlocks around ${time}, and this photo keeps its place until then.`;
}

const ToggleRow = React.memo(function ToggleRow({
  label,
  hint,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  /** Held while the change is in flight, so the switch cannot be flipped twice. */
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[text.body, { color: paper.text }]}>{label}</Text>
        <Text style={[text.caption, { color: paper.textMuted }]}>{hint}</Text>
      </View>

      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: marmalade[500], false: paper.hairlineHi }}
        thumbColor={paper.surface}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: paper.bg,
  },
  scrollView: {
    flex: 1,
  },
  /**
   * The gutters and the bottom clearance live here, not on a wrapper inside.
   *
   * The sheet's own background is the `Animated.View` around this, so padding on the content
   * is padding *inside* the surface — which is what keeps the last row clear of the floating
   * tab bar's shutter without leaving a transparent strip under it.
   */
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.gutter,
    /*
     * Clears the fixed back and share buttons.
     *
     * At full height the sheet's top edge is level with them, and the score row is left
     * aligned — so without this the first thing the sheet shows sits under the one control
     * that leaves the screen. Reserved at every position rather than only at full, because a
     * padding that changes on snap relayouts the content mid-spring.
     */
    paddingTop: spacing.lg,
    paddingBottom: layout.tabBarClearance,
  },
  /**
   * The photograph, pinned behind the sliding content.
   *
   * `chrome.fill` rather than the paper background: a letterboxed edge on a dark photo
   * should read as the frame the picture sits in, not as the app showing through.
   */
  photoLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: chrome.fill,
  },
  /**
   * Only an affordance now — the whole sheet is the drag target.
   *
   * It stays because a sheet with no grabber does not look draggable, and the interaction is
   * worth advertising even when nobody has to aim at it.
   */
  grabberHit: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: paper.hairlineHi,
  },
  gap: {
    marginTop: spacing.sm,
  },
  /** Pinned to the top and travelling with the sheet, so the scrim leaves when the sheet does. */
  heroLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
  },
  /** Catches taps on the picture. Grows to the whole screen once the sheet is out of the way. */
  photoTap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Deeper than the old block so the fade has room to be invisible. The darkness at the
    // very bottom is unchanged; what changed is that it arrives gradually.
    height: '58%',
  },
  heroChrome: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: layout.gutter,
    // Clears the sheet's overlap, so the name is never half-covered by it.
    paddingBottom: spacing.xl + SHEET_OVERLAP,
  },
  heroTitle: {
    color: chrome.text,
    flexShrink: 1,
  },
  /**
   * Absolutely positioned and always full height, moved between the three snap points by
   * `translateY`. Sizing it per position would relayout its whole subtree on every frame.
   */
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    backgroundColor: paper.bg,
  },
  /**
   * The waiting state, styled as a block rather than as an error.
   *
   * A photograph without a score is not a failure — it is the ordinary path once somebody
   * takes a third photo in a day — so this is a sunken panel like every other resting
   * surface here, not a warning tint.
   */
  unscored: {
    marginTop: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: paper.sunken,
    gap: spacing.sm,
  },
  unscoredHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  /** The way to the photographer, directly above their score. */
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    minHeight: 44,
  },
  authorName: {
    flex: 1,
    color: paper.text,
  },
  /**
   * A footnote, spaced off the breakdown above it rather than boxed.
   *
   * It is one line of caption type and it is the only thing on this screen about a person
   * rather than about the photograph, so it gets air instead of a container — a card around it
   * would give it the weight of a section.
   */
  revealCredit: {
    marginTop: spacing.sm,
  },
  breakdown: {
    marginTop: spacing.sm,
  },
  votes: {
    marginTop: spacing.md,
  },
  ownNote: {
    marginTop: spacing.xs,
    color: paper.textFaint,
  },
  noPhoto: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.xs + 2,
    borderRadius: radii.lg,
    backgroundColor: paper.sunkenSoft,
  },
  dexThumb: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  /** No photograph to show, so the tile carries a glyph and has to centre it. */
  dexThumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Sits tight under the Dex row so the two read as one block, not two controls. */
  notThisCat: {
    marginTop: spacing.xxs,
    alignSelf: 'flex-start',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  communityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  communityNote: {
    marginTop: spacing.md,
    color: paper.textFaint,
  },
  saveCaption: {
    marginTop: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  toggleText: {
    flex: 1,
    gap: 1,
  },
  actions: {
    marginTop: spacing.xxl,
    gap: spacing.xs,
  },
});
