import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Image as ImageGlyph } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { challengeApi } from '../../api/endpoints';
import { Button } from '../../components/Button';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { PhotoCard } from '../../components/PhotoCard';
import { Screen, ScreenHeader } from '../../components/Screen';
import { PhotoCardSkeleton } from '../../components/Skeleton';
import { showToast } from '../../components/Toast';
import type { Photo } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { glass, paper, marmalade, layout, radii, spacing, text } from '../../theme';
import type { ChallengesStackParamList } from '../../navigation/types';

/**
 * Challenge Submission (README section 5.4).
 *
 * Pick one photo from the album. Entering is explicit and reversible-by-replacement:
 * submitting a second photo moves the entry rather than adding one, and the screen says
 * so before the player commits.
 *
 * Entering also shares the photo to the feed — it has to be visible to be judged — and
 * that is stated up front rather than discovered afterwards.
 *
 * ## The action does not scroll
 *
 * It sits on a bar above the tab bar, always visible. The whole screen is a grid of photos
 * that the player scrolls while choosing, and a button parked under the last row means
 * picking a photo near the top and then hunting downward for the way to confirm it. The
 * bar names what is selected, so the thing being confirmed is legible from the control
 * doing the confirming.
 *
 * There is no Cancel next to it. Cancel is what the back arrow in the header already does,
 * on every other screen in the app, and a second one here would be the only place that
 * needed two. Nothing is committed until the button is pressed, so leaving costs nothing.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'ChallengeSubmission'>;

export function ChallengeSubmissionScreen({ route, navigation }: Props) {
  const { challengeId, title } = route.params;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const upsertPhoto = useAlbumStore((s) => s.upsert);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await challengeApi.eligiblePhotos();
      setPhotos(result.photos);
      // Preselect an existing entry so "change my entry" opens on what is already in.
      const entered = result.photos.find((p) => p.submittedToChallengeId === challengeId);
      if (entered) setSelectedId(entered.id);
    } catch {
      setError('We could not load your photos.');
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!selectedId) return;

    setSubmitting(true);
    try {
      const result = await challengeApi.submit(challengeId, selectedId);
      await upsertPhoto(result.photo);

      showToast(
        result.alreadyEntered ? 'That photo was already entered' : 'Entry submitted',
        'success'
      );
      navigation.navigate('ChallengeEntries', { challengeId, title });
    } catch {
      showToast('We could not submit that entry. Try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [challengeId, navigation, selectedId, title, upsertPhoto]);

  const cardWidth = useMemo(
    () => (width - layout.gutter * 2 - layout.gridGap) / 2,
    [width]
  );

  const currentEntry = photos.find((p) => p.submittedToChallengeId === challengeId);
  const selected = photos.find((p) => p.id === selectedId);

  return (
    <Screen bleed>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.xs,
            // Clears the tab bar *and* the action bar riding above it.
            paddingBottom: layout.tabBarClearance + ACTION_BAR_H,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Pick a photo"
          subtitle={`Entering ${title}. Your entry is shared to the community feed so it can be judged.`}
        />

        {currentEntry ? (
          <View style={styles.notice}>
            <Text style={[text.bodySm, { color: paper.textMuted }]}>
              You already have an entry. Picking a different photo replaces it.
            </Text>
          </View>
        ) : null}

        {error ? <InlineError message={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <View style={styles.grid}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={{ width: cardWidth }}>
                <PhotoCardSkeleton index={i} />
              </View>
            ))}
          </View>
        ) : photos.length === 0 ? (
          <EmptyState
            title="No photos to enter"
            body="Photograph a cat first, then come back and enter your best shot."
            Glyph={ImageGlyph}
          />
        ) : (
          <View style={styles.grid}>
            {photos.map((photo, index) => (
              <View
                key={photo.id}
                style={[
                  styles.selectable,
                  { width: cardWidth },
                  selectedId === photo.id ? styles.selected : null,
                ]}
              >
                <PhotoCard
                  photo={photo}
                  index={index}
                  onPress={() => setSelectedId(photo.id)}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {photos.length > 0 ? (
        <View
          style={[
            styles.actionBar,
            { bottom: insets.bottom + layout.tabBarLift + layout.tabBarHeight + spacing.sm },
          ]}
        >
          {/*
            Glass rather than an opaque strip: photographs scroll under this bar, and a
            solid panel over them would read as the grid being cut off rather than as a
            control floating above it.
          */}
          <BlurView
            intensity={glass.intensity}
            tint={glass.tintLight}
            style={[StyleSheet.absoluteFill, styles.actionBarSkin]}
          />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.actionBarWash]} />

          <Text style={[text.caption, styles.actionHint]} numberOfLines={1}>
            {selected
              ? `Selected · ${selected.catNickname}`
              : 'Pick a photo to enter'}
          </Text>

          <Button
            label={currentEntry ? 'Replace my entry' : 'Enter this photo'}
            onPress={() => void submit()}
            disabled={!selectedId}
            loading={submitting}
            trailingIcon
            fullWidth
          />
        </View>
      ) : null}
    </Screen>
  );
}

/** Hint line, button and the bar's own padding. */
const ACTION_BAR_H = 104;

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
  },
  notice: {
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.gridGap,
    marginTop: spacing.md,
  },
  selectable: {
    borderRadius: radii.xl,
    // A 2px ring rather than an overlay, so the photo is never dimmed by its own
    // selection state — the player is choosing between photos and has to see them.
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 2,
  },
  selected: {
    borderColor: marmalade[500],
  },
  actionBar: {
    position: 'absolute',
    left: layout.tabBarInset,
    right: layout.tabBarInset,
    padding: spacing.sm,
    gap: spacing.xs,
    borderRadius: radii.xxl,
    overflow: 'hidden',
  },
  actionBarSkin: {
    borderRadius: radii.xxl,
  },
  /** Lifts the blur toward the page colour so white type on the button stays anchored. */
  actionBarWash: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  actionHint: {
    color: paper.textMuted,
    textAlign: 'center',
  },
});
