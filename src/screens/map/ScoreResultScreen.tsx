import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Badge, Eyebrow } from '../../components/Badge';
import { CaptionSuggestions } from '../../components/CaptionSuggestionChip';
import { ScoreBreakdown } from '../../components/ScoreBreakdown';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { useAlbumStore } from '../../store/albumStore';
import { useCaptureStore } from '../../store/captureStore';
import {
  arena,
  radii,
  rarity as rarityTokens,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../../theme';
import type { MapStackParamList } from '../../navigation/types';

/**
 * Score Result Screen (README section 5.2).
 *
 * The reveal. Arena context, because this is a committed full-screen moment rather than
 * a card in a list.
 *
 * The order the screen animates in is the order the player cares about: the photo, then
 * the title and tier, then the score tallying up, then the caption tools. Putting the
 * caption field first would make the player edit text before they know what they scored.
 *
 * There is always an explicit exit — no dead-end screens (DESIGN.md 6.3).
 */

type Nav = NativeStackNavigationProp<MapStackParamList, 'ScoreResult'>;

export function ScoreResultScreen() {
  const navigation = useNavigation<Nav>();
  const reduceMotion = useReduceMotion();

  const result = useCaptureStore((s) => s.result);
  const resetCapture = useCaptureStore((s) => s.reset);
  const setCaption = useAlbumStore((s) => s.setCaption);
  const setShared = useAlbumStore((s) => s.setShared);

  const [caption, setCaptionText] = useState('');
  const [saving, setSaving] = useState(false);

  const hero = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      hero.value = 1;
      return;
    }

    hero.value = withDelay(
      120,
      withSpring(1, spring.overshoot)
    );
  }, [hero, reduceMotion]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: hero.value,
    transform: [{ scale: 0.94 + hero.value * 0.06 }],
  }));

  const done = useCallback(() => {
    resetCapture();
    // Back to the map, not back to the camera: `replace` was used to get here, so the
    // camera is no longer on the stack and popping lands on the map.
    navigation.goBack();
  }, [navigation, resetCapture]);

  const saveCaption = useCallback(async () => {
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

  const share = useCallback(async () => {
    if (!result) return;

    try {
      // Sharing outward also shares inward: a photo the player is posting elsewhere is
      // one they have decided is public, so it goes to the community feed too.
      if (!result.photo.sharedToFeed) {
        await setShared(result.photo.id, true);
      }

      await Share.share({
        message: caption.trim() || result.photo.badges[0] || 'A cat, caught mid-moment.',
        url: result.photo.imageUrl || undefined,
      });
    } catch {
      showToast('We could not open the share sheet.', 'error');
    }
  }, [caption, result, setShared]);

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
        <Text style={[text.h2, { color: arena.text }]}>That result has expired</Text>
        <Text style={[text.body, styles.emptyBody]}>
          The photo is safe in your album. Open it there to see the full breakdown.
        </Text>
        <Button label="Back to the map" context="arena" onPress={done} />
      </View>
    );
  }

  const { photo, cat, isNewCat, captionSuggestions, xpAwarded, rankUp } = result;
  const spec = rarityTokens[photo.tier];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.heroWrap, heroStyle]}>
          <View style={[styles.hero, { borderColor: spec.ring }]}>
            <Image
              source={photo.imageUrl || undefined}
              contentFit="cover"
              transition={260}
              style={StyleSheet.absoluteFill}
              accessible
              accessibilityLabel={`Your photo of ${photo.catNickname}`}
            />
            {!photo.imageUrl ? (
              <View style={styles.noPhoto}>
                <Text style={[text.caption, { color: arena.textFaint }]}>No image</Text>
              </View>
            ) : null}
          </View>
        </Animated.View>

        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Eyebrow label={photo.tier} context="arena" />
            {isNewCat ? <Badge label="New cat" tone="accent" context="arena" /> : null}
          </View>

          <Text style={[text.display, styles.title]}>{photo.catNickname}</Text>

          <Text style={[text.bodySm, styles.subtitle]}>
            {isNewCat
              ? 'Nobody had photographed this cat before. It is in your Cat Dex now.'
              : `You have photographed this cat ${cat.encounterCount} times.`}
          </Text>
        </View>

        <Text style={[text.caption, styles.layerNote]}>
          This is the app's take. Share it and the community decides your rank.
        </Text>

        <View style={styles.card}>
          <ScoreBreakdown
            scores={photo.scores}
            pose={photo.pose}
            tier={photo.tier}
            badges={photo.badges}
            animate
            context="arena"
          />
        </View>

        {/* Rank-up is announced separately rather than folded into the score, because it
            is the only thing on this screen that changes the player's account. */}
        {rankUp ? (
          <View style={[styles.rankUp, { borderColor: spec.ring }]}>
            <Text style={[text.h3, { color: arena.text }]}>
              {`Rank ${rankUp.to} — ${rankUp.title}`}
            </Text>
            <Text style={[text.bodySm, styles.subtitle]}>
              New camera filters and frames are available in the shop.
            </Text>
          </View>
        ) : (
          <Text style={[text.caption, styles.xp]}>{`+${xpAwarded} XP`}</Text>
        )}

        <View style={styles.captionBlock}>
          <Text style={[text.h3, { color: arena.text }]}>Add a caption</Text>

          <CaptionSuggestions
            suggestions={captionSuggestions}
            selected={caption || null}
            onSelect={setCaptionText}
            context="arena"
            style={styles.suggestions}
          />

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

        <View style={styles.actions}>
          <Button
            label={caption.trim() ? 'Save and finish' : 'Finish'}
            onPress={() => void saveCaption()}
            loading={saving}
            context="arena"
            trailingIcon
          />
          <Button label="Share this shot" variant="secondary" context="arena" onPress={() => void share()} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: arena.bg,
  },
  content: {
    padding: spacing.md,
    paddingTop: spacing.huge,
    paddingBottom: spacing.xxxl,
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
  heroWrap: {
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.xxl,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: arena.surface,
  },
  noPhoto: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    marginTop: spacing.lg,
    gap: spacing.xxs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  title: {
    color: arena.text,
  },
  subtitle: {
    color: arena.textMuted,
  },
  layerNote: {
    marginTop: spacing.xl,
    color: arena.textFaint,
  },
  card: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.xxl,
    backgroundColor: arena.surface,
  },
  rankUp: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.xxs,
  },
  xp: {
    marginTop: spacing.sm,
    color: arena.textFaint,
    textAlign: 'center',
  },
  captionBlock: {
    marginTop: spacing.xxl,
    gap: spacing.sm,
  },
  suggestions: {
    marginBottom: spacing.xxs,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
});
