import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { CaptionSuggestions } from '../../components/CaptionSuggestionChip';
import { ScoreBreakdown } from '../../components/ScoreBreakdown';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { useAlbumStore } from '../../store/albumStore';
import { useCaptureStore } from '../../store/captureStore';
import {
  arena,
  chrome,
  photoScrim,
  radii,
  spacing,
  spring,
  text,
  useReduceMotion,
} from '../../theme';
import { TierCrest } from '../../components/TierCrest';
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
 * There is always an explicit exit — no dead-end screens (DESIGN.md 6.3).
 */

type Nav = NativeStackNavigationProp<MapStackParamList, 'ScoreResult'>;

export function ScoreResultScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const result = useCaptureStore((s) => s.result);
  const resetCapture = useCaptureStore((s) => s.reset);
  const setCaption = useAlbumStore((s) => s.setCaption);
  const setShared = useAlbumStore((s) => s.setShared);

  const [caption, setCaptionText] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

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
        <StatusBar style="light" />
        <Text style={[text.h2, { color: arena.text }]}>That result has expired</Text>
        <Text style={[text.body, styles.emptyBody]}>
          The photo is safe in your album. Open it there to see the full breakdown.
        </Text>
        <Button label="Back to the map" context="arena" onPress={done} />
      </View>
    );
  }

  const { photo, cat, isNewCat, captionSuggestions, xpAwarded, rankUp } = result;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* The shot itself, full bleed and dimmed to a backdrop. */}
      <Image
        source={photo.imageUrl || undefined}
        contentFit="cover"
        transition={320}
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityLabel={`Your photo of ${photo.catNickname}`}
      />
      <View pointerEvents="none" style={styles.dimUpper} />
      <View pointerEvents="none" style={styles.dimLower} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.hero, scoreStyle]}>
          <Text style={[text.eyebrow, styles.eyebrow]}>Your score</Text>
          <Text style={[text.displayHuge, styles.score]}>{photo.scores.total}</Text>

          <TierCrest tier={photo.tier} style={styles.crest} />
          <Text style={[text.h2, styles.tierLabel]}>{photo.tier}</Text>

          <Text style={[text.bodySm, styles.subtitle]}>
            {isNewCat
              ? `${photo.catNickname} is new — nobody had photographed this cat before.`
              : `${photo.catNickname}, photographed ${cat.encounterCount} times.`}
          </Text>
        </Animated.View>

        {/*
          Badges are the one place tilt is allowed. They are the closest thing this app
          has to stickers, and stickers put on straight look printed rather than applied.
        */}
        {photo.badges.length > 0 ? (
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

        {rankUp ? (
          <View style={styles.rankUp}>
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

        <View style={styles.actions}>
          <Button
            label="Share to feed"
            onPress={() => void share()}
            context="arena"
            trailingIcon
          />
          <Button
            label={caption.trim() ? 'Save and finish' : 'Save to Dex'}
            variant="ghost"
            context="arena"
            loading={saving}
            onPress={() => void saveCaption()}
          />
        </View>

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
          </View>
        ) : null}

        {isNewCat ? (
          <Badge label="New to your Dex" tone="accent" style={styles.newCat} />
        ) : null}
      </ScrollView>
    </View>
  );
}

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
   * Two stops rather than one flat wash. The top of the frame only has to hold an eyebrow
   * and a numeral; the bottom has to hold body copy and two buttons, so it goes much
   * darker. A single opacity that satisfied the bottom would black out the photo entirely.
   */
  dimUpper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: photoScrim.revealTop,
  },
  dimLower: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    backgroundColor: photoScrim.revealBottom,
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
    marginTop: spacing.xl,
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
  newCat: {
    marginTop: spacing.lg,
  },
});
