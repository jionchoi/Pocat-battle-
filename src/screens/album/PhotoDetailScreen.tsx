import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import {
  CaretLeft,
  CaretRight,
  ImageBroken,
  ShareNetwork,
} from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { photoApi } from '../../api/endpoints';
import { Badge, RarityBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { CircleButton } from '../../components/CircleButton';
import { ConfirmSheet } from '../../components/BottomSheet';
import { EmptyState } from '../../components/EmptyState';
import { ScoreBreakdown } from '../../components/ScoreBreakdown';
import { Screen, SectionHeader } from '../../components/Screen';
import { SkeletonBlock } from '../../components/Skeleton';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { VoteRow } from '../../components/VoteButton';
import type { Photo, Reaction } from '../../models';
import { useAlbumStore } from '../../store/albumStore';
import { useAuthStore } from '../../store/authStore';
import { usePhotoReaction } from '../../hooks/usePhotoReaction';
import { useReactionStore } from '../../store/reactionStore';
import { COMMUNITY_CONFIG, communityLabel } from '../../constants/game';
import {
  chrome,
  layout,
  paper,
  marmalade,
  photoScrim,
  radii,
  spacing,
  text,
} from '../../theme';
import { relativeTime } from '../../utils/format';

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
 * How far the sheet rides up over the photo. Enough to read as an overlap and to hide the
 * seam where the scrim ends; not so much that it eats the bottom of the crop.
 */
const SHEET_OVERLAP = 18;

type PhotoDetailParams = {
  PhotoDetail: { photoId: string };
  /** Both stacks that mount this screen register a CatProfile of their own. */
  CatProfile: { catId: string };
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
  const setShowcased = useAlbumStore((s) => s.setShowcased);
  const remove = useAlbumStore((s) => s.remove);
  const pinDexPhoto = useAlbumStore((s) => s.pinDexPhoto);
  const unpinDexPhoto = useAlbumStore((s) => s.unpinDexPhoto);
  const cats = useAlbumStore((s) => s.cats);
  const loadCatDex = useAlbumStore((s) => s.loadCatDex);

  const [photo, setPhoto] = useState<Photo | null>(cached ?? null);
  const [missing, setMissing] = useState(false);
  const [caption, setCaptionText] = useState(cached?.caption ?? '');
  const [savingCaption, setSavingCaption] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinningDex, setPinningDex] = useState(false);

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
    (photoId: string, apply: (p: Photo) => Photo) => {
      setPhoto((current) => (current && current.id === photoId ? apply(current) : current));
    },
    []
  );

  const reactTo = usePhotoReaction(patchPhoto);

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

  const isMine = viewerId !== null && photo.ownerId === viewerId;

  return (
    <View style={styles.root}>
      {/* The hero runs under the notch, so the clock has to invert to stay readable. */}
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xxxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/*
          Full-bleed hero at a little over half the screen. Cropping the photo to a card
          on the one screen dedicated to that photo is the wrong instinct — this is the
          only place in the product where the image gets to be the size it deserves.
        */}
        <View style={[styles.hero, { height: heroHeight }]}>
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

          <View pointerEvents="none" style={styles.heroScrim} />

          <View style={[styles.heroChrome, { top: insets.top + spacing.xs }]}>
            <CircleButton
              Glyph={CaretLeft}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Go back"
            />
            <CircleButton
              Glyph={ShareNetwork}
              onPress={() => void share()}
              accessibilityLabel="Share this shot"
              glyphSize={17}
            />
          </View>

          <View style={styles.heroFoot} pointerEvents="none">
            <Text style={[text.h1, styles.heroTitle]} numberOfLines={1}>
              {photo.catNickname}
            </Text>
            <RarityBadge rarity={photo.tier} size="lg" />
          </View>
        </View>

        {/*
          The sheet rides up over the photo's bottom edge. That overlap is what makes the
          two read as one object rather than as a picture with a panel below it — and it
          hides the seam where the scrim ends, which is otherwise a visible band.
        */}
        <View style={styles.sheet}>
          <View style={styles.scoreRow}>
            <Text style={[text.statLg, { color: paper.text }]}>{photo.scores.total}</Text>
            <Text style={[text.caption, styles.scoreOutOf]}>/ 100 overall</Text>
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
            The viewer's own reaction is read from the store rather than from `photo`,
            because the store is where it actually lives — the detail payload is shared
            and carries no viewer. Reading it from one place is what stops the button and
            the feed disagreeing after a round trip.
          */}
          <VoteRow
            reactions={photo.reactions}
            myReaction={myReactions[photo.id] ?? null}
            onReact={react}
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
          </DividedGroup>

          {/*
            The Dex gets its own section and its own paragraph because it is the one
            control here whose effect is somewhere else in the app. "Save to Dex" on the
            reveal screen is this same switch, and a player who pressed it there and
            wondered what moved should find the answer written out here.
          */}
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

          <View style={styles.actions}>
            <Button label="Share this shot" onPress={() => void share()} trailingIcon />
            <Button
              label="Delete photo"
              variant="ghost"
              destructive
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
        </View>
      </ScrollView>

      <ConfirmSheet
        visible={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void confirmDelete()}
        title="Delete this photo?"
        body="This cannot be undone. If it is your best shot of this cat, your next-best takes its place in the Cat Dex."
        confirmLabel={deleting ? 'Deleting' : 'Delete'}
        destructive
      />
    </View>
  );
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
  scroll: {
    flexGrow: 1,
  },
  gap: {
    marginTop: spacing.sm,
  },
  hero: {
    width: '100%',
    backgroundColor: chrome.fill,
    justifyContent: 'flex-end',
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
    backgroundColor: photoScrim.posterBottom,
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
  sheet: {
    flex: 1,
    marginTop: -SHEET_OVERLAP,
    paddingTop: spacing.lg,
    paddingHorizontal: layout.gutter,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    backgroundColor: paper.bg,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  scoreOutOf: {
    color: paper.textFaint,
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
    ...StyleSheet.absoluteFillObject,
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
