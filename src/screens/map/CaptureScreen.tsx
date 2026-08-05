import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CaptureOverlay } from '../../components/CaptureOverlay';
import { Button } from '../../components/Button';
import { showToast } from '../../components/Toast';
import { CAPTURE_CONFIG } from '../../constants/game';
import { useCameraPermission } from '../../hooks/useCameraPermission';
import { useCatDetection } from '../../hooks/useCatDetection';
import { useFramingWindow } from '../../hooks/useFramingWindow';
import { useLocation } from '../../hooks/useLocation';
import { photoApi } from '../../api/endpoints';
import { ApiRequestError } from '../../api/client';
import { preparePhotoForUpload } from '../../services/catDetection';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { useCaptureStore } from '../../store/captureStore';
import { arena, radii, spacing, text } from '../../theme';
import type { MapStackParamList } from '../../navigation/types';

/**
 * Capture Screen (README section 5.2).
 *
 * The whole game loop lives here:
 *   live detection -> stable -> framing window -> shutter (or auto) -> submit -> reveal
 *
 * Arena context, fully immersive. The tab bar slides away, the status bar goes light,
 * and there is no light surface anywhere on the screen.
 */

type Nav = NativeStackNavigationProp<MapStackParamList, 'Capture'>;

export function CaptureScreen() {
  const navigation = useNavigation<Nav>();
  const camera = useRef<CameraView | null>(null);

  const cameraPermission = useCameraPermission();
  const { permission: locationPermission, position, request: requestLocation } =
    useLocation({ watch: true });

  const phase = useCaptureStore((s) => s.phase);
  const box = useCaptureStore((s) => s.box);
  const setDetection = useCaptureStore((s) => s.setDetection);
  const beginCapture = useCaptureStore((s) => s.beginCapture);
  const beginScoring = useCaptureStore((s) => s.beginScoring);
  const succeed = useCaptureStore((s) => s.succeed);
  const reject = useCaptureStore((s) => s.reject);
  const resetCapture = useCaptureStore((s) => s.reset);

  const upsertPhoto = useAlbumStore((s) => s.upsert);
  const upsertCat = useAlbumStore((s) => s.upsertCat);
  const applyRewards = useAuthStore((s) => s.applyCaptureRewards);
  const shareByDefault = useAuthStore((s) => s.user?.proSubscriptionActive ?? false);

  const [ready, setReady] = useState(false);
  const [shareToFeed, setShareToFeed] = useState(false);

  // Guards a double-fire: the shutter tap and the window's auto-capture can land in the
  // same frame, and submitting the same moment twice would cost the player two slots.
  const submitting = useRef(false);

  /* ----------------------------- detection loop ---------------------------- */

  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!camera.current || !ready) return null;

    try {
      const shot = await camera.current.takePictureAsync({
        quality: 0.25,
        skipProcessing: true,
        // These are analysis frames, not photographs. The detection loop grabs one every
        // 220ms, and each `takePictureAsync` plays the system shutter by default — which
        // is a camera audibly firing over and over at someone trying to photograph a cat.
        // The player never sees these frames and they are never saved.
        shutterSound: false,
      });
      return shot?.uri ?? null;
    } catch {
      // The camera can refuse mid-focus or while backgrounding. A dropped analysis
      // frame is normal and must not surface as an error.
      return null;
    }
  }, [ready]);

  const detection = useCatDetection({
    captureFrame,
    enabled:
      ready && cameraPermission.granted && (phase === 'scanning' || phase === 'framing'),
  });

  useEffect(() => {
    setDetection(detection.result?.box ?? null, detection.result?.confidence ?? 0);
  }, [detection.result, setDetection]);

  /* --------------------------- the framing window -------------------------- */

  // The window needs to fire `submit`, and `submit` needs to read how long the window
  // was held. Routing the auto-capture through a ref breaks that cycle without making
  // either one depend on the other's identity.
  const submitRef = useRef<(auto: boolean) => void>(() => undefined);

  const framing = useFramingWindow({
    stable: detection.stable,
    detected: detection.result?.found ?? false,
    onAutoCapture: () => submitRef.current(true),
    enabled: ready && cameraPermission.granted,
  });

  /* ------------------------------- submission ------------------------------ */

  const submit = useCallback(
    async (auto: boolean) => {
      if (submitting.current) return;

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
      beginCapture(auto);

      try {
        const shot = await camera.current?.takePictureAsync({
          quality: 1,
        });

        if (!shot?.uri) throw new Error('The camera did not return a photo.');

        const photoBase64 = await preparePhotoForUpload(shot.uri);

        beginScoring(position);

        const result = await photoApi.submit({
          photoBase64,
          location: position,
          clientConfidence: detection.bestConfidence,
          framingHeldMs: Math.round(framing.heldMs()),
          autoCaptured: auto,
          // Every capture attempt optionally logs a map pin (README 9.6).
          logSighting: true,
          shareToFeed,
        });

        if (result.outcome === 'rejected') {
          reject(result.reason, result.message);
          return;
        }

        await upsertPhoto(result.photo);
        upsertCat(result.cat);
        applyRewards({
          xpAwarded: result.xpAwarded,
          scoreAwarded: result.photo.scores.total,
        });

        succeed(result);
        navigation.replace('ScoreResult');
      } catch (err) {
        const message =
          err instanceof ApiRequestError
            ? err.message
            : 'We could not save that photo. Try again.';

        // A network failure is not a game outcome, so it does not become a rejection
        // screen — the player stays on the camera and can simply shoot again.
        showToast(message, 'error');
        resetCapture();
      } finally {
        submitting.current = false;
      }
    },
    [
      applyRewards,
      beginCapture,
      beginScoring,
      detection.bestConfidence,
      framing,
      navigation,
      position,
      reject,
      resetCapture,
      shareToFeed,
      succeed,
      upsertCat,
      upsertPhoto,
    ]
  );

  submitRef.current = (auto: boolean) => void submit(auto);

  /* --------------------------------- setup -------------------------------- */

  useEffect(() => {
    resetCapture();
    setShareToFeed(shareByDefault);
  }, [resetCapture, shareByDefault]);

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
            ? 'Camera access is turned off for CatSnap. You can turn it back on in your device settings.'
            : 'CatSnap uses the camera to spot cats and score your photos. Nothing is uploaded until you take a shot.'}
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

  /* -------------------------------- camera -------------------------------- */

  return (
    <View style={styles.root}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setReady(true)}
      />

      {/* Fixed grain overlay above the preview. Never attached to a scroll container. */}
      <View pointerEvents="none" style={styles.grain} />

      <CaptureOverlay
        phase={phase}
        box={box}
        progress={framing.progress}
        remainingMs={framing.remainingMs}
        detectionStreak={detection.streak}
        framesRequired={CAPTURE_CONFIG.stableDetectionFrames}
        onShutter={() => void submit(false)}
        onClose={close}
        shareToFeed={shareToFeed}
        onToggleShare={() => setShareToFeed((value) => !value)}
      />

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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: arena.bg,
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
