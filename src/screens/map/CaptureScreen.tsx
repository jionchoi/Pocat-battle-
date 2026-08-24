import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CaptureOverlay } from '../../components/CaptureOverlay';
import { CaptureFilterLayer } from '../../components/CaptureFilterLayer';
import { ScoringOverlay } from '../../components/ScoringOverlay';
import { Button } from '../../components/Button';
import { showToast } from '../../components/Toast';
import { useCameraPermission } from '../../hooks/useCameraPermission';
import { useLocation } from '../../hooks/useLocation';
import { photoApi } from '../../api/endpoints';
import { ApiRequestError } from '../../api/client';
import { uploadCapture } from '../../lib/photoUpload';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { CAPTURE_PROGRESS, useCaptureStore } from '../../store/captureStore';
import { DEFAULT_FILTER_ID } from '../../constants/filters';
import { arena, radii, spacing, text } from '../../theme';
import type { MapStackParamList } from '../../navigation/types';

/**
 * Capture Screen (README section 5.2).
 *
 * The whole game loop lives here:
 *   live camera -> shutter -> submit -> reveal
 *
 * Capture is manual, entirely. There was an on-device detector feeding a framing window that
 * armed itself and fired on its own, and it is gone — it was a texture-and-motion heuristic
 * rather than a cat detector, so what it actually did was make a player wait several frames
 * for permission to photograph a cat that was plainly there. The person holding the phone
 * knows when the moment is right. Nothing here second-guesses them.
 *
 * Arena context, fully immersive. The tab bar slides away, the status bar goes light,
 * and there is no light surface anywhere on the screen.
 */

type Nav = NativeStackNavigationProp<MapStackParamList, 'Capture'>;

export function CaptureScreen() {
  const navigation = useNavigation<Nav>();
  const camera = useRef<CameraView | null>(null);

  /**
   * The chosen look, held here rather than in the overlay.
   *
   * The overlay unmounts the moment the shutter fires — the scoring overlay replaces it — so
   * a selection living inside it would reset to Natural on every shot. It is deliberately
   * *not* in `captureStore` either: that store is the state of one capture in flight, and
   * this outlives a capture without being part of one.
   *
   * Preview-only, and never sent anywhere. Nothing downstream of the shutter reads it: the
   * uploaded bytes are the camera's own frame. See `constants/filters.ts`.
   */
  const [filterId, setFilterId] = useState<string>(DEFAULT_FILTER_ID);

  const cameraPermission = useCameraPermission();
  const { permission: locationPermission, position, request: requestLocation } =
    useLocation({ watch: true });

  const phase = useCaptureStore((s) => s.phase);
  const beginCapture = useCaptureStore((s) => s.beginCapture);
  const attachLocalPhoto = useCaptureStore((s) => s.attachLocalPhoto);
  const advance = useCaptureStore((s) => s.advance);
  const localUri = useCaptureStore((s) => s.localUri);
  const progress = useCaptureStore((s) => s.progress);
  const beginScoring = useCaptureStore((s) => s.beginScoring);
  const succeed = useCaptureStore((s) => s.succeed);
  const reject = useCaptureStore((s) => s.reject);
  const resetCapture = useCaptureStore((s) => s.reset);

  const upsertPhoto = useAlbumStore((s) => s.upsert);

  /**
   * From the session, not the profile.
   *
   * These are not the same id arriving by two routes. `applySession` deliberately leaves
   * `user` null when the profile fetch fails on anything but a missing row — the session is
   * real, so the player stays signed in and carries on — which means one slow or failed read
   * at launch left this null and broke *every* capture for the rest of the session with
   * "You are not signed in." The session is the thing that says who somebody is, and it was
   * there the whole time.
   *
   * Capture wants it only to build a storage path, and the path is checked against the
   * token's `sub` by the bucket policy, so the JWT's own id is also the only one that could
   * ever be right here.
   */
  const userId = useAuthStore((s) => s.session?.user?.id ?? null);

  const [ready, setReady] = useState(false);

  /**
   * Which of the sensor's capture resolutions to actually use.
   *
   * `undefined` until the camera has been asked what it supports, which is what makes this a
   * fix rather than a guess: sizes are per-device and per-lens, so there is no constant to
   * hardcode.
   *
   * **This is why photographs looked soft.** With the prop unset, expo-camera picks a default
   * capture size, and on Android that default is routinely a mid-tier preview-grade resolution
   * rather than the sensor's full still size — so the pipeline was downscaling 2048px from a
   * source that was sometimes barely wider than that, and every later stage was working from
   * an image the hardware never needed to give up. The same phone in its own camera app uses
   * the full size, which is exactly the comparison that made this look like a bug in the app.
   */
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  /**
   * Latched, because setting `pictureSize` reconfigures the capture session and fires
   * `onCameraReady` again. Without this the screen would ask, set, re-ready, ask again —
   * a reconfiguration loop on the one screen that has to be live and responsive.
   */
  const sizeChosen = useRef(false);

  /**
   * Whether this screen is the one being looked at.
   *
   * A stack screen is not unmounted when you navigate off it — it stays alive underneath,
   * and so does everything it started. Every loop below is gated on this, because a camera
   * screen that keeps running while nobody is on it takes photographs of nothing, fires
   * auto-captures at a torn-down preview, and reports each one as an error.
   */
  const isFocused = useIsFocused();

  // Guards a double-fire: the shutter tap and the window's auto-capture can land in the
  // same frame, and submitting the same moment twice would cost the player two slots.
  const submitting = useRef(false);

  /**
   * Set immediately before the reveal takes over.
   *
   * The blur handler below abandons an unfinished capture, and a successful one blurs on its
   * way to the reveal — which is the one departure that must not be treated as abandonment.
   */
  const headingToReveal = useRef(false);

  /* ------------------------------- submission ------------------------------ */

  const submit = useCallback(
    async () => {
      if (submitting.current) return;

      // A tap can still be in flight as the screen goes away. Taking a photograph for
      // somebody who is no longer looking at the camera is the "Camera unmounted during
      // taking photo process" error, and it spends a reveal to produce it.
      if (!isFocused) return;

      if (!position) {
        // Location is required: without it the photo cannot be matched to a cat or
        // placed on the map, and the score would be missing its rarity input.
        reject(
          'location-required',
          'We need your location to score a photo. Turn on location access and try again.'
        );
        return;
      }

      submitting.current = true;
      beginCapture();

      /** Set when the failure path navigates out, so `finally` does not re-arm the shutter. */
      let leaving = false;

      try {
        const shot = await camera.current?.takePictureAsync({
          quality: 1,
        });

        if (!shot?.uri) throw new Error('The camera did not return a photo.');

        if (!userId) throw new Error('You are not signed in.');

        /*
         * Straight to storage, not through the API.
         *
         * `uploadCapture` downscales and puts the bytes in the bucket under this player's
         * own folder, which the storage policy is what actually enforces. The request that
         * follows carries a path — a couple of hundred bytes instead of a couple of
         * megabytes of base64, and the server fetches the image from storage on a
         * connection that is not a phone on mobile data.
         */
        const uploaded = await uploadCapture(shot.uri, userId);

        // The downscaled copy is what the reveal renders and what "Save to phone" writes.
        attachLocalPhoto(uploaded.localUri);
        advance(CAPTURE_PROGRESS.prepared);

        beginScoring(position);

        const result = await photoApi.capture({
          storagePath: uploaded.storagePath,
          location: position,
          capturedAt: new Date().toISOString(),
          /*
           * `detected` is deliberately not sent.
           *
           * It existed so the phone could tell the server "there is no cat here, do not pay
           * for a scoring call", and it was worth having while the phone chose the moment.
           * A manual shutter makes the tap itself the signal: somebody looked at the scene
           * and decided it was worth a photograph, and a texture heuristic overruling that
           * would spend their shot to save a call. The server reads an absent flag as
           * "did not say", which scores — and the reveal allowance, `no_cat_at` and
           * `scoring_attempts` are all still in front of the model.
           */
        });

        await upsertPhoto(result.photo);

        // Let the scoring ring close before the reveal takes over. Cutting away while the
        // arc is still filling wastes the one moment the wait was building towards, and
        // 320ms is under the threshold where a player would call it a delay.
        await new Promise((resolve) => setTimeout(resolve, 320));

        /*
         * Hand the response to the store before navigating, not after.
         *
         * This call was missing entirely, and the symptom was the whole reveal: the screen
         * reads the capture from `captureStore.result`, so without it every capture arrived
         * at a screen with nothing to draw. It is placed after the ring's closing beat so
         * the phase flips to `revealed` on the way out rather than mid-animation.
         */
        succeed(result);

        // Before the navigation, so the blur this causes is not mistaken for the player
        // walking away from an unfinished capture.
        headingToReveal.current = true;
        navigation.replace('ScoreResult');
      } catch (err) {
        /*
         * Logged before it is turned into copy.
         *
         * The toast below is deliberately vague, and everything interesting about a failed
         * capture is thrown away by it — a storage policy rejection, a missing global, a
         * malformed path all arrive at the player as the same sentence. That is right for
         * the player and useless for anyone debugging, and this catch sits across three
         * different subsystems (the camera, the bucket, the API).
         */
        console.error('[capture] failed:', err);

        const message =
          err instanceof ApiRequestError
            ? err.message
            : 'We could not save that photo. Try again.';

        showToast(message, 'error');
        resetCapture();

        /*
         * Leave the camera rather than stand on it.
         *
         * Staying put looks like resilience and behaves like a trap: the tab bar is hidden
         * on this screen, so a player left staring at a camera that fails every shot has
         * nothing to press to escape.
         *
         * Backing out to the map is also what puts the map tab back where it belongs: this
         * screen sits on the map's own stack, so a capture abandoned here is what leaves
         * the tab showing a camera the next time it is opened.
         */
        leaving = navigation.canGoBack();
        if (leaving) navigation.goBack();
      } finally {
        /*
         * Latched while we are on our way out, so a tap landing during the transition cannot
         * run `takePictureAsync` against a camera that is already unmounting. The focus
         * effect clears it on the way back in, which is what stops the latch outliving one
         * capture and silently swallowing every shutter press after it.
         */
        if (!leaving) submitting.current = false;
      }
    },
    [
      advance,
      attachLocalPhoto,
      beginCapture,
      beginScoring,
      isFocused,
      navigation,
      position,
      reject,
      resetCapture,
      succeed,
      upsertPhoto,
      userId,
    ]
  );

  /* --------------------------------- setup -------------------------------- */

  /*
   * Reset every time the screen is looked at, not once when it is created.
   *
   * `phase` lives in a store that outlives this component, and the component outlives being
   * on screen — a stack keeps it mounted underneath whatever was pushed on top. Resetting on
   * mount therefore ran exactly once, and every later visit inherited the phase the previous
   * capture ended on. At `revealed` that made `scoringInProgress` true, which renders the
   * scoring overlay *instead of* the one carrying the shutter: a camera that cannot be
   * photographed with and reports nothing wrong, because nothing was.
   *
   * Nothing is reset on the way out. The reveal screen reads its result out of this same
   * store, so clearing on blur would hand it an empty one and put every successful capture on
   * the "that result has expired" fallback.
   */
  useFocusEffect(
    useCallback(() => {
      resetCapture();
      // Cleared here rather than in `submit`'s `finally`, which cannot run on the path that
      // navigates away — see the note there. A latch that outlives one capture silently
      // swallows every shutter press after it.
      submitting.current = false;
      headingToReveal.current = false;
    }, [resetCapture])
  );

  /*
   * An abandoned capture does not stay on the map's stack.
   *
   * This screen is pushed onto the map tab, so leaving it any way other than through the
   * reveal leaves a camera sitting on top of the map — and the next press of the Map tab
   * opens the camera again rather than the map. Going back on blur means the tab holds what
   * its name promises.
   */
  useEffect(
    () =>
      navigation.addListener('blur', () => {
        if (headingToReveal.current) return;
        if (navigation.canGoBack()) navigation.goBack();
      }),
    [navigation]
  );

  useEffect(() => {
    if (cameraPermission.state === 'undetermined') void cameraPermission.request();
  }, [cameraPermission]);

  useEffect(() => {
    if (locationPermission === 'undetermined') void requestLocation();
  }, [locationPermission, requestLocation]);

  const close = useCallback(() => {
    resetCapture();
    navigation.goBack();
  }, [navigation, resetCapture]);

  /* ------------------------------ permissions ----------------------------- */

  if (!cameraPermission.granted) {
    return (
      <View style={styles.gate}>
        <Text style={[text.h2, styles.gateTitle]}>Camera access is needed</Text>
        <Text style={[text.body, styles.gateBody]}>
          {cameraPermission.blocked
            ? 'Camera access is turned off for Cat Frame. You can turn it back on in your device settings.'
            : 'Cat Frame uses the camera to spot cats and score your photos. Nothing is uploaded until you take a shot.'}
        </Text>

        <View style={styles.gateActions}>
          {!cameraPermission.blocked ? (
            <Button
              label="Allow camera access"
              context="arena"
              onPress={() => void cameraPermission.request()}
              trailingIcon
            />
          ) : null}
          <Button label="Go back" variant="ghost" context="arena" onPress={close} />
        </View>
      </View>
    );
  }

  /**
   * Asks the camera what it can shoot, and takes the biggest.
   *
   * Runs once per mount, after the session is live — the list is not available before then.
   * Failure is non-fatal on purpose: an unset `pictureSize` is exactly the state this screen
   * was in before, so the worst case is the old behaviour rather than a camera that will not
   * open. A capture is never blocked on this.
   */
  const chooseLargestPictureSize = useCallback(async () => {
    if (sizeChosen.current) return;
    sizeChosen.current = true;

    try {
      const sizes = await camera.current?.getAvailablePictureSizesAsync();
      const best = largestPictureSize(sizes ?? []);
      if (best) setPictureSize(best);
    } catch {
      // Left unset. See above — this degrades to the previous behaviour, not to a failure.
    }
  }, []);

  /* -------------------------------- camera -------------------------------- */

  /** Shutter fired, verdict not yet on screen. `revealed` is the ring's closing frame. */
  const scoringInProgress =
    phase === 'capturing' || phase === 'scoring' || phase === 'revealed';

  return (
    <View style={styles.root}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        pictureSize={pictureSize}
        onCameraReady={() => {
          setReady(true);
          void chooseLargestPictureSize();
        }}
      />

      {/*
        The filter, composited straight onto the preview and onto nothing else.

        Order is the whole of it: this sits directly above `CameraView` and below everything
        that follows, so it grades the photograph and leaves the chrome alone. The grain below
        is film texture and belongs on top of a grade, which is also the order a darkroom
        would put them in.
      */}
      <CaptureFilterLayer filterId={filterId} />

      {/* Fixed grain overlay above the preview. Never attached to a scroll container. */}
      <View pointerEvents="none" style={styles.grain} />

      {/*
        The camera's controls exist while there is a camera to control. Once the shutter
        has fired they are not disabled — they are gone, replaced by the frozen frame and
        the scoring ring. Leaving a dimmed shutter and a detection box visible under the
        wait would show the player two states of the same screen at once.
      */}
      {scoringInProgress ? (
        <ScoringOverlay phase={phase} photoUri={localUri} progress={progress} />
      ) : (
        <CaptureOverlay
          phase={phase}
          onShutter={() => void submit()}
          onClose={close}
          filterId={filterId}
          onSelectFilter={setFilterId}
        />
      )}

      {phase === 'rejected' ? (
        <RejectionNotice onRetry={resetCapture} onClose={close} />
      ) : null}
    </View>
  );
}

/**
 * Rejection notice.
 *
 * A rejection is part of the loop, not an error dialog — no `Alert.alert`, and the copy
 * says what to do differently rather than what went wrong.
 *
 * A full album is the one rejection that retrying cannot fix, so it exits to the map
 * instead of dropping the player back on a camera that will refuse the next shot too.
 */
function RejectionNotice({
  onRetry,
  onClose,
}: {
  onRetry: () => void;
  onClose: () => void;
}) {
  const rejection = useCaptureStore((s) => s.rejection);
  if (!rejection) return null;

  const unrecoverable = rejection.reason === 'album-full';

  return (
    <View style={styles.rejection}>
      <View style={styles.rejectionCard}>
        <Text style={[text.h3, { color: arena.text }]}>Not scored</Text>
        <Text style={[text.body, styles.rejectionBody]}>{rejection.message}</Text>
        <Button
          label={unrecoverable ? 'Manage my album' : 'Try again'}
          context="arena"
          onPress={unrecoverable ? onClose : onRetry}
        />
      </View>
    </View>
  );
}

/**
 * The largest still resolution in a list from `getAvailablePictureSizesAsync`.
 *
 * The two platforms answer this question in different vocabularies and both have to be
 * handled, because the whole point is to stop relying on a default.
 *
 * **iOS** returns `AVCaptureSession` preset names alongside dimensions — `'photo'`, `'high'`,
 * `'medium'`, `'low'`, `'1920x1080'`. `'photo'` is not one size among them: it is the preset
 * meaning "full-resolution still capture", which is the sensor's native photograph and is
 * larger than any of the numbered video presets. So it wins outright when present, and
 * comparing it by area is impossible anyway — it has no digits to parse.
 *
 * **Android** returns plain `WxH` strings, so the largest is the largest by pixel area. Area
 * rather than width: a device can offer both 4:3 and 16:9 at the same width, and the 4:3 one
 * carries more pixels for a subject that is usually upright.
 *
 * Anything unparseable is ignored rather than guessed at.
 */
export function largestPictureSize(sizes: readonly string[]): string | undefined {
  if (sizes.length === 0) return undefined;

  // iOS: the full-resolution still preset outranks every numbered one. See above.
  if (sizes.includes('photo')) return 'photo';

  let best: string | undefined;
  let bestArea = 0;

  for (const size of sizes) {
    const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec(size.trim());
    if (!match) continue;

    const area = Number(match[1]) * Number(match[2]);
    if (area > bestArea) {
      bestArea = area;
      best = size;
    }
  }

  return best;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: arena.bg,
    /*
     * Contains the filter's blend mode.
     *
     * `mixBlendMode` composites against everything painted beneath it in the same stacking
     * context. Without an explicit isolate that context is whatever ancestor happens to
     * establish one, so a `saturation` layer could reach past the camera and drain the colour
     * from the tab bar behind this screen. This makes the boundary the screen itself.
     */
    isolation: 'isolate',
  },
  /**
   * A hair of darkness over the preview. Not decoration: every piece of chrome on this
   * screen is white or coral sitting directly on an uncontrolled image, and a bright
   * scene washes all of it out. Three percent is enough to hold the contrast and far
   * below the point where the viewfinder stops matching the shot.
   */
  grain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    opacity: 0.03,
  },
  gate: {
    flex: 1,
    backgroundColor: arena.bg,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  gateTitle: {
    color: arena.text,
  },
  gateBody: {
    color: arena.textMuted,
  },
  gateActions: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  rejection: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: arena.scrim,
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  rejectionCard: {
    backgroundColor: '#161618',
    borderRadius: radii.xxl,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.xxxl,
  },
  rejectionBody: {
    color: arena.textMuted,
  },
});
