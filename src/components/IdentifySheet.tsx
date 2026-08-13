import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { CaretRight, Cat as CatGlyph, Plus } from 'phosphor-react-native';

import {
  contextColors,
  hitSlopFor,
  icon,
  marmalade,
  radii,
  spacing,
  text,
  type ContextName,
} from '../theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { TextField } from './TextField';
import type { CatCandidate, IdentifyChoice } from '../models';

/**
 * "Is this Mochi?"
 *
 * The moment the player says which cat a photograph is of. Everything about cat identity on
 * the server exists to put this question well, and nothing anywhere answers it automatically:
 * a vision model asked "is this the same cat" is wrong in both directions, and the second kind
 * of wrong folds two animals into one Dex entry with nothing left to separate them. So the
 * server shortlists and the player decides. Confirmation is the feature.
 *
 * ## Dismissible, unlike the full-album sheet
 *
 * Closing this is a real answer. An unidentified photograph is an ordinary state — the album
 * already draws one, `catNickname` is simply empty, and "Not this cat?" on the photo's detail
 * screen is the way back at any point afterwards. The album-full sheet refuses to close
 * because every way out of *that* one deletes something and not answering leaves the next
 * capture refused; nothing here strands anything. A player who wants the number and the street
 * should not have a compulsory question between them and the door.
 *
 * ## An empty shortlist still opens it
 *
 * Absent and empty mean different things, and the difference is load-bearing. A server with no
 * matching omits `candidates` entirely and this never opens. `[]` means the matcher looked and
 * found nobody nearby — which is exactly the "this is a cat nobody has recorded" case, and the
 * only path by which a first cat ever enters the world. Treating the two alike would make the
 * Dex unreachable on an empty database.
 *
 * ## No number is ever shown
 *
 * `confidence` orders the list and marks the top row, and that is all it may do. It is not a
 * claim about the animal, and a percentage beside a cat's name reads as one. The same rule is
 * why `reasons` arrive as finished phrases from the server: precision about where somebody
 * else's cat lives is decided next to the data, not here.
 */

export const IdentifySheet = React.memo(function IdentifySheet({
  visible,
  candidates,
  busy,
  context = 'paper',
  title,
  onChoose,
  onDismiss,
}: {
  visible: boolean;
  candidates: CatCandidate[];
  busy: boolean;
  context?: ContextName;
  /** Overridden on re-identification, where the question is not "which cat" but "which instead". */
  title?: string;
  onChoose: (choice: IdentifyChoice) => void;
  onDismiss: () => void;
}) {
  const c = contextColors(context);

  /** Open on the naming step rather than the list when there is no list to show. */
  const [naming, setNaming] = useState(candidates.length === 0);
  const [nickname, setNickname] = useState('');

  const close = useCallback(() => {
    // Reset on the way out, not on the way in: this component stays mounted behind the
    // reveal screen, and a name half-typed into a dismissed sheet should not be waiting
    // there when it is opened again for a different photograph.
    setNaming(candidates.length === 0);
    setNickname('');
    onDismiss();
  }, [candidates.length, onDismiss]);

  const submitNew = useCallback(() => {
    const trimmed = nickname.trim();
    if (trimmed.length === 0) return;

    onChoose({ newCat: { nickname: trimmed } });
  }, [nickname, onChoose]);

  const heading =
    title ?? (naming ? 'Name this cat' : candidates.length > 0 ? 'Is this one of these?' : 'A new cat');

  return (
    <BottomSheet visible={visible} onClose={close} title={heading} context={context} scrollable>
      {naming ? (
        <View style={styles.naming}>
          <Text style={[text.body, { color: c.textMuted }]}>
            {candidates.length > 0
              ? 'Give them a name and they go into your Cat Dex. Anyone who photographs them later sees this name until they pick their own.'
              : 'No cats have been recorded near here yet. Name this one and they are the first — anyone who photographs them later sees this name until they pick their own.'}
          </Text>

          <TextField
            label="Name"
            value={nickname}
            onChangeText={setNickname}
            placeholder="Mochi"
            maxLength={30}
            context={context}
            autoFocus
            helper="You can rename them in your Cat Dex whenever you like."
          />

          <Button
            label="Add to my Cat Dex"
            onPress={submitNew}
            disabled={nickname.trim().length === 0 || busy}
            loading={busy}
            context={context}
            fullWidth
            icon={Plus}
          />

          {/*
            Only offered when there is a list to go back to. On an empty shortlist this would
            be a control that returns to nothing.
          */}
          {candidates.length > 0 ? (
            <Button
              label="Back to the list"
              variant="ghost"
              onPress={() => setNaming(false)}
              disabled={busy}
              context={context}
              fullWidth
            />
          ) : null}
        </View>
      ) : (
        <>
          <Text style={[text.body, { color: c.textMuted }]}>
            Cats seen around here that look like yours. Pick one, or add a new cat.
          </Text>

          <View style={styles.list}>
            {candidates.map((candidate, index) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                /*
                 * Only the first row, and only when there is something to be first among.
                 * A "best guess" mark on the top of a one-item list says nothing — every
                 * list of one has a top — and on a list of two near-identical cats it is
                 * the whole reason the ordering was worth computing.
                 */
                best={index === 0 && candidates.length > 1}
                disabled={busy}
                context={context}
                onPress={() => onChoose({ catId: candidate.id })}
              />
            ))}
          </View>

          <View style={styles.actions}>
            <Button
              label="None of these — it's a new cat"
              variant="secondary"
              onPress={() => setNaming(true)}
              disabled={busy}
              context={context}
              fullWidth
              icon={Plus}
            />

            {/*
              Saying so plainly, because the alternative reading is that closing loses the
              photograph. It does not: the shot is in the album either way, and this is the
              one question on the screen that can be answered later without cost.
            */}
            <Button
              label="Not sure yet"
              variant="ghost"
              onPress={close}
              disabled={busy}
              context={context}
              fullWidth
              accessibilityHint="Leaves this photo unidentified. You can name the cat later from the photo."
            />
          </View>
        </>
      )}
    </BottomSheet>
  );
});

/**
 * One cat on the shortlist.
 *
 * The two halves of the row are doing different jobs. The name and the thumbnail say *which
 * animal*; the reasons say *why we are asking*, and they are the part that makes the question
 * answerable — "seen nearby, black and white, notched left ear" is something a person can
 * check against the photograph they just took, where a name alone is a guess.
 *
 * A candidate the player has never met draws a silhouette rather than a photograph. The tile
 * is somebody else's picture, and they are being asked whether they recognise the animal, not
 * shown one. `thumbnailUrl` is null in exactly that case and the server is what guarantees it.
 */
const CandidateRow = React.memo(function CandidateRow({
  candidate,
  best,
  disabled,
  context,
  onPress,
}: {
  candidate: CatCandidate;
  best: boolean;
  disabled: boolean;
  context: ContextName;
  onPress: () => void;
}) {
  const c = contextColors(context);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlopFor(56)}
      accessibilityRole="button"
      accessibilityLabel={
        candidate.inYourDex
          ? `${candidate.nickname}, in your Cat Dex, photographed ${candidate.encounterCount} times`
          : `${candidate.nickname}, a cat you have not photographed before`
      }
      accessibilityHint={candidate.reasons.join(', ')}
      style={[
        styles.row,
        { backgroundColor: c.sunken },
        best && styles.rowBest,
        disabled && styles.rowDisabled,
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: c.surface }]}>
        {candidate.thumbnailUrl ? (
          <Image
            source={candidate.thumbnailUrl}
            contentFit="cover"
            transition={160}
            style={StyleSheet.absoluteFill}
            accessible={false}
          />
        ) : (
          <CatGlyph size={22} color={c.textFaint} weight="duotone" />
        )}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.nameLine}>
          <Text style={[text.h3, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>
            {candidate.nickname}
          </Text>

          {best ? (
            <View style={styles.bestChip}>
              <Text style={[text.captionSm, styles.bestChipText]}>Best guess</Text>
            </View>
          ) : null}
        </View>

        {/*
          Rendered exactly as they arrive. These are written server-side so the wording is
          not a deploy and so precision is decided next to the data — never reformatted,
          never joined into a sentence that implies more than the phrases do.
        */}
        <Text style={[text.caption, { color: c.textMuted }]} numberOfLines={2}>
          {candidate.reasons.join(' · ')}
        </Text>

        {/*
          Only for a cat the player has actually photographed. Telling someone they have
          "seen this cat 4 times" about an animal they have never met is the exact confusion
          `inYourDex` exists to prevent.
        */}
        {candidate.inYourDex ? (
          <Text style={[text.captionSm, { color: c.textFaint }]}>
            {candidate.encounterCount === 1
              ? 'In your Cat Dex · met once'
              : `In your Cat Dex · met ${candidate.encounterCount} times`}
          </Text>
        ) : (
          <Text style={[text.captionSm, { color: c.textFaint }]}>
            New to you — someone else recorded them
          </Text>
        )}
      </View>

      <CaretRight size={icon.size.sm} color={c.textFaint} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  naming: {
    gap: spacing.md,
  },
  list: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  /** The mark is the border plus the chip, never a number. */
  rowBest: {
    borderColor: marmalade[500],
  },
  rowDisabled: {
    opacity: 0.5,
  },
  /**
   * The ratio lives on this plain View, not on a Pressable with an absoluteFill child —
   * that combination renders a correctly sized blank with nothing in it and no error.
   */
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  bestChip: {
    paddingHorizontal: spacing.xxs,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: marmalade[500],
  },
  bestChipText: {
    color: '#FFFFFF',
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
});
