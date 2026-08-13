import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Check } from 'phosphor-react-native';

import {
  arena,
  icon,
  marmalade,
  radii,
  spacing,
  text,
} from '../theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import type { Photo } from '../models';

/**
 * The album is full, and one photograph has to go.
 *
 * Raised by the reveal screen when a capture pushed the album past its cap. It is the only
 * sheet in the app the player cannot simply dismiss, and that is deliberate rather than
 * hostile: both ways out delete something, so a third way out that deletes nothing would
 * leave the album over its limit and the next capture refused with no explanation of what
 * happened. The choice is small and it is the player's, but it does have to be made.
 *
 * ## Why both buttons are honest about the score
 *
 * The photograph that triggered this is already stored and already scored — the shutter is
 * not what the cap restricts. So the reveal has been spent whichever branch the player
 * takes, and discarding the new photo does not hand it back. That is stated in the body
 * rather than discovered afterwards from an allowance that did not move.
 *
 * ## Two taps to delete, never one
 *
 * Tapping a photograph selects it; a separate button deletes it. A grid where one tap
 * destroys a photo forever is a grid nobody can scroll safely, and this is the one delete
 * in the app with nothing behind it — no trash, no undo, and since the bucket object goes
 * too, no copy anywhere.
 */

const GRID_GAP = spacing.xxs;
const COLUMNS = 3;

export const AlbumFullSheet = React.memo(function AlbumFullSheet({
  visible,
  limit,
  count,
  photos,
  busy,
  onDeleteExisting,
  onDiscardNew,
  onOpenShop,
}: {
  visible: boolean;
  limit: number;
  count: number;
  /** The player's existing album, for choosing from. */
  photos: Photo[];
  busy: boolean;
  onDeleteExisting: (photoId: string) => void;
  onDiscardNew: () => void;
  onOpenShop: () => void;
}) {
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<string | null>(null);

  // The sheet's own padding, then the gaps between three tiles.
  const tile = Math.floor(
    (width - spacing.lg * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS
  );

  return (
    <BottomSheet
      visible={visible}
      /*
       * Closing is not an outcome, so the scrim's close handler is a no-op rather than a
       * dismiss. Leaving the sheet open on an accidental backdrop tap is the correct
       * behaviour for a prompt where every real answer is a deletion.
       */
      onClose={() => {}}
      title="Your album is full"
      context="arena"
      scrollable
    >
      <Text style={[text.body, { color: arena.textMuted }]}>
        {`That shot is saved and scored — it is number ${count}, and your album holds ${limit}. Pick one to delete, or discard the one you just took. The score you spent does not come back either way.`}
      </Text>

      {photos.length === 0 ? (
        /*
         * The album has not finished loading. Discarding is still available because it
         * needs nothing but the new photo's id, so the player is never stuck behind a
         * request — they simply cannot choose a different victim until the grid arrives.
         */
        <Text style={[text.caption, styles.loading]}>Loading your album…</Text>
      ) : (
        <View style={styles.grid}>
          {photos.map((photo) => {
            const isSelected = photo.id === selected;

            return (
              <Pressable
                key={photo.id}
                onPress={() => setSelected(isSelected ? null : photo.id)}
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={
                  photo.catNickname
                    ? `Photo of ${photo.catNickname}, scoring ${photo.scores.total}`
                    : `Unidentified photo, scoring ${photo.scores.total}`
                }
                accessibilityHint="Select this photo to delete it"
                style={[
                  styles.tile,
                  { width: tile, height: tile },
                  isSelected && styles.tileSelected,
                ]}
              >
                <Image
                  source={{ uri: photo.imageUrl }}
                  style={styles.image}
                  contentFit="cover"
                  transition={120}
                />

                {isSelected ? (
                  <View style={styles.check}>
                    <Check
                      size={icon.size.sm}
                      color={arena.text}
                      weight={icon.weightActive}
                    />
                  </View>
                ) : null}

                {/*
                  The score, because it is the one thing that makes this choice decidable.
                  A grid of thumbnails all looks worth keeping; the number is what tells a
                  player which of two similar shots of the same cat was the good one.
                */}
                <View style={styles.scoreChip}>
                  <Text style={[text.captionSm, { color: arena.text }]}>
                    {photo.scoredAt ? photo.scores.total : '—'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <Button
          label={selected ? 'Delete the photo I picked' : 'Pick a photo to delete'}
          onPress={() => selected && onDeleteExisting(selected)}
          disabled={!selected || busy}
          loading={busy}
          context="arena"
          fullWidth
          accessibilityHint="Permanently deletes the selected photo and keeps your new one"
        />

        <Button
          label="Discard the one I just took"
          variant="ghost"
          onPress={onDiscardNew}
          disabled={busy}
          context="arena"
          fullWidth
          accessibilityHint="Permanently deletes the photo you just captured. Your score is not refunded."
        />

        {/*
          The upgrade sits last and reads as a way out rather than the point of the sheet.
          This is the moment Pro is genuinely relevant — the player is blocked by storage,
          which is the only thing Pro changes — but a prompt that puts buying above the two
          free answers is an ad wearing a dialog's clothes.
        */}
        <Button
          label="Go Pro for unlimited storage"
          variant="ghost"
          onPress={onOpenShop}
          disabled={busy}
          context="arena"
          fullWidth
        />
      </View>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  loading: {
    marginTop: spacing.lg,
    color: arena.textFaint,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    marginTop: spacing.lg,
  },
  tile: {
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: arena.sunken,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: {
    borderColor: marmalade[500],
  },
  image: {
    width: '100%',
    height: '100%',
  },
  check: {
    position: 'absolute',
    top: spacing.xxs,
    right: spacing.xxs,
    width: 22,
    height: 22,
    borderRadius: radii.full,
    backgroundColor: marmalade[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreChip: {
    position: 'absolute',
    left: spacing.xxs,
    bottom: spacing.xxs,
    paddingHorizontal: spacing.xxs,
    paddingVertical: 1,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(11, 11, 12, 0.62)',
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
});
