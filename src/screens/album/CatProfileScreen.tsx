import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { PawPrint } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { catdexApi } from '../../api/endpoints';
import { Badge, RarityBadge } from '../../components/Badge';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { PhotoCard } from '../../components/PhotoCard';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { SkeletonBlock } from '../../components/Skeleton';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import type { CatProfile } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { bone, layout, radii, spacing, text } from '../../theme';
import type { AlbumStackParamList } from '../../navigation/types';
import { pluralize, relativeTime } from '../../utils/format';

/**
 * Cat Profile (README section 5.3).
 *
 * Every photo this player has of one specific real cat, plus the encounter history and
 * the places it has turned up. The mini map is the part that makes a cat feel like it
 * lives somewhere: three pins on one street corner is a very different animal from three
 * pins scattered across a neighbourhood.
 */

type Props = NativeStackScreenProps<AlbumStackParamList, 'CatProfile'>;

export function CatProfileScreen({ route, navigation }: Props) {
  const { catId } = route.params;
  const { width } = useWindowDimensions();

  const renameCat = useAlbumStore((s) => s.renameCat);

  const [profile, setProfile] = useState<CatProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await catdexApi.profile(catId);
      setProfile(result);
      setNickname(result.cat.nickname ?? '');
      setBio(result.cat.bio ?? '');
    } catch {
      setError('We could not load that cat.');
    } finally {
      setLoading(false);
    }
  }, [catId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!profile) return;

    setSaving(true);
    try {
      await renameCat(catId, nickname.trim(), bio.trim());
      setProfile({
        ...profile,
        cat: { ...profile.cat, nickname: nickname.trim(), bio: bio.trim() },
      });
      setEditing(false);
    } catch {
      showToast('We could not save that. Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }, [bio, catId, nickname, profile, renameCat]);

  const cardWidth = useMemo(
    () => (width - layout.gutter * 2 - layout.gridGap) / 2,
    [width]
  );

  if (loading) {
    return (
      <Screen scroll>
        <SkeletonBlock width="60%" height={26} />
        <SkeletonBlock width="40%" height={14} style={styles.skeletonGap} />
        <SkeletonBlock width="100%" height={160} radius={radii.xl} style={styles.skeletonGap} />
      </Screen>
    );
  }

  // A deep link can point at a cat this player has never photographed, or one whose
  // last photo they just deleted. Both land here, and both need a real way out.
  if (error || !profile) {
    return (
      <Screen>
        <ScreenHeader title="Cat not found" />
        {error ? <InlineError message={error} onRetry={() => void load()} /> : null}
        <EmptyState
          title="This cat has moved on"
          body="You have no photos of this cat, so there is nothing to show. It may have been removed when you deleted your last shot of it."
          Glyph={PawPrint}
          actionLabel="Back to the Cat Dex"
          onAction={() => navigation.navigate('CatDex')}
        />
      </Screen>
    );
  }

  const { cat, photos, encounterLocations, firstEncounterAt } = profile;

  return (
    <Screen scroll>
      <ScreenHeader
        title={cat.nickname ?? 'Unnamed cat'}
        subtitle={cat.bio || undefined}
        right={<Button label="Edit" variant="ghost" onPress={() => setEditing(true)} />}
      />

      <View style={styles.badges}>
        <RarityBadge rarity={cat.bestTier} />
        {cat.discoveredByMe ? <Badge label="Discovered by you" tone="accent" /> : null}
      </View>

      {/* Encounter history as prose rather than a stat block — these are facts about a
          relationship, and a grid of numbers would read as a character sheet. */}
      <View style={styles.history}>
        <Text style={[text.body, { color: bone.textMuted }]}>
          {`You first photographed this cat ${relativeTime(firstEncounterAt)}, and have `}
          {`seen it ${pluralize(cat.encounterCount, 'time')} since. Your best shot `}
          {`scored ${cat.bestPhotoScore}.`}
        </Text>
      </View>

      {encounterLocations.length > 0 ? (
        <>
          <SectionHeader
            title="Where you have seen it"
            description={
              encounterLocations.length === 1
                ? 'Always in the same spot so far.'
                : `${encounterLocations.length} different spots.`
            }
          />

          <View style={styles.mapWrap}>
            <MapView
              style={StyleSheet.absoluteFill}
              initialRegion={{
                latitude: encounterLocations[0].lat,
                longitude: encounterLocations[0].lng,
                latitudeDelta: 0.006,
                longitudeDelta: 0.006,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
            >
              {encounterLocations.map((point, index) => (
                <Marker
                  key={`${point.lat},${point.lng}`}
                  coordinate={{ latitude: point.lat, longitude: point.lng }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                >
                  <View style={styles.miniPin}>
                    <Text style={[text.caption, styles.miniPinText]}>{index + 1}</Text>
                  </View>
                </Marker>
              ))}
            </MapView>
          </View>
        </>
      ) : null}

      <SectionHeader title="Your photos" description={pluralize(photos.length, 'shot')} />

      <View style={styles.grid}>
        {photos.map((photo, index) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            index={index}
            onPress={() => navigation.navigate('PhotoDetail', { photoId: photo.id })}
            style={{ width: cardWidth }}
          />
        ))}
      </View>

      <BottomSheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="Name this cat"
      >
        <View style={styles.form}>
          <TextField
            label="Nickname"
            value={nickname}
            onChangeText={setNickname}
            placeholder="What do you call it?"
            maxLength={30}
            helper="Only you see this name."
          />

          <TextField
            label="Notes"
            value={bio}
            onChangeText={setBio}
            placeholder="Where it hangs out, what it does"
            maxLength={200}
            multiline
            
          />

          <Button label="Save" onPress={() => void save()} loading={saving} trailingIcon />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletonGap: {
    marginTop: spacing.sm,
  },
  badges: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  history: {
    marginTop: spacing.md,
  },
  mapWrap: {
    height: 180,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: bone.hairline,
  },
  miniPin: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    backgroundColor: bone.surface,
    borderWidth: 1.5,
    borderColor: bone.hairlineHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPinText: {
    color: bone.text,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.gridGap,
  },
  form: {
    gap: spacing.md,
  },
});
