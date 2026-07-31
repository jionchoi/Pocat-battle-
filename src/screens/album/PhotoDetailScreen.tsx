import React, { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageBroken } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { photoApi } from '../../api/endpoints';
import { Badge, RarityBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { ConfirmSheet } from '../../components/BottomSheet';
import { EmptyState } from '../../components/EmptyState';
import { ScoreBreakdown } from '../../components/ScoreBreakdown';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { SkeletonBlock } from '../../components/Skeleton';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import type { Photo } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { COMMUNITY_CONFIG, communityLabel } from '../../constants/game';
import { bone, fern, radii, spacing, text } from '../../theme';
import type { AlbumStackParamList } from '../../navigation/types';
import { relativeTime } from '../../utils/format';

/**
 * Photo Detail (README section 5.3).
 *
 * Full-size photo, the score breakdown in its resting state, the caption, and the two
 * controls that change who can see it. Sharing and showcasing are the only actions here
 * with consequences outside the album, so they are grouped and labelled plainly rather
 * than buried in an icon row.
 */

type Props = NativeStackScreenProps<AlbumStackParamList, 'PhotoDetail'>;

export function PhotoDetailScreen({ route, navigation }: Props) {
  const { photoId } = route.params;

  const cached = useAlbumStore((s) => s.byId(photoId));
  const setCaption = useAlbumStore((s) => s.setCaption);
  const setShared = useAlbumStore((s) => s.setShared);
  const setShowcased = useAlbumStore((s) => s.setShowcased);
  const remove = useAlbumStore((s) => s.remove);

  const [photo, setPhoto] = useState<Photo | null>(cached ?? null);
  const [missing, setMissing] = useState(false);
  const [caption, setCaptionText] = useState(cached?.caption ?? '');
  const [savingCaption, setSavingCaption] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // Refetch even when cached: reactions and challenge status change server-side, and
    // the cached copy is whatever the album last synced.
    photoApi
      .detail(photoId)
      .then((result) => {
        setPhoto(result.photo);
        setCaptionText(result.photo.caption ?? '');
      })
      .catch(() => {
        if (!cached) setMissing(true);
      });
  }, [cached, photoId]);

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

  if (missing) {
    return (
      <Screen>
        <ScreenHeader title="Photo not found" />
        <EmptyState
          title="This photo has moved on"
          body="It may have been deleted from another device. Your other photos are unaffected."
          Glyph={ImageBroken}
          actionLabel="Back to your album"
          onAction={() => navigation.navigate('PhotoAlbumGrid')}
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

  return (
    <Screen scroll>
      <View style={styles.hero}>
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
            <Text style={[text.caption, { color: bone.textFaint }]}>No image</Text>
          </View>
        ) : null}
      </View>

      <ScreenHeader
        title={photo.catNickname}
        subtitle={`Captured ${relativeTime(photo.capturedAt)}`}
      />

      <View style={styles.badges}>
        <RarityBadge rarity={photo.tier} />
        {photo.submittedToChallengeId ? (
          <Badge label="Challenge entry" tone="accent" />
        ) : null}
        {photo.showcased ? <Badge label="Showcased" tone="neutral" /> : null}
      </View>

      <SectionHeader
        title="What the app thought"
        description="Scored the moment you took it, from composition, pose and how unusual the cat is."
      />

      <Card padding={spacing.lg}>
        <ScoreBreakdown
          scores={photo.scores}
          pose={photo.pose}
          tier={photo.tier}
          badges={photo.badges}
        />
      </Card>

      {/*
        The second scoring layer. Deliberately a separate block from the breakdown above,
        because the two are different opinions and the gap between them is the point — a
        photo the app rated modestly that people loved is the interesting outcome.
      */}
      <SectionHeader
        title="What people thought"
        description="Reactions from other players. This is what decides your rank."
      />

      <Card padding={spacing.lg}>
        {!photo.sharedToFeed ? (
          <Text style={[text.body, { color: bone.textMuted }]}>
            This photo is private, so nobody has seen it. Share it to the feed and
            reactions start counting toward your rank.
          </Text>
        ) : (
          <>
            <View style={styles.communityRow}>
              <View>
                <Text style={[text.caption, { color: bone.textMuted }]}>Reactions</Text>
                <Text style={[text.statLg, { color: bone.text }]}>{photo.voteCount}</Text>
              </View>
              <View>
                <Text style={[text.caption, { color: bone.textMuted }]}>Seen by</Text>
                <Text style={[text.statLg, { color: bone.text }]}>{photo.viewCount}</Text>
              </View>
              <View>
                <Text style={[text.caption, { color: bone.textMuted }]}>Reacted</Text>
                <Text style={[text.statLg, { color: bone.text }]}>
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

      <SectionHeader
        title="Sharing"
        description="Your album is private. Nothing here is visible to anyone until you share it."
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
      </DividedGroup>

      <View style={styles.actions}>
        <Button label="Share this shot" onPress={() => void share()} trailingIcon />
        <Button
          label="Delete photo"
          variant="ghost"
          destructive
          onPress={() => setConfirmingDelete(true)}
        />
      </View>

      <ConfirmSheet
        visible={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void confirmDelete()}
        title="Delete this photo?"
        body="This cannot be undone. If it is your best shot of this cat, your next-best takes its place in the Cat Dex."
        confirmLabel={deleting ? 'Deleting' : 'Delete'}
        destructive
      />
    </Screen>
  );
}

const ToggleRow = React.memo(function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[text.body, { color: bone.text }]}>{label}</Text>
        <Text style={[text.caption, { color: bone.textMuted }]}>{hint}</Text>
      </View>

      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: fern[500], false: bone.hairlineHi }}
        thumbColor={bone.surface}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  gap: {
    marginTop: spacing.sm,
  },
  hero: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.xxl,
    overflow: 'hidden',
    backgroundColor: bone.sunken,
  },
  noPhoto: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: bone.textFaint,
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
