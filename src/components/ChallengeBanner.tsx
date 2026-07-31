import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Challenge } from '../models';
import {
  contextColors,
  semantic,
  spacing,
  text,
  type ContextName,
} from '../theme';
import { Badge, Eyebrow } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { countdownLabel } from '../utils/format';

/**
 * ChallengeBanner — the current prompt, its countdown and the entry CTA (README §6).
 *
 * The prompt is the hero, not the title: "A cat with all four feet off the ground" is
 * what tells a player what to go and shoot. The title is a label for the leaderboard.
 *
 * A challenge the player has already entered shows that state instead of a CTA — an
 * enter button that silently replaces your existing entry is a trap.
 */

export const ChallengeBanner = React.memo(function ChallengeBanner({
  challenge,
  onEnter,
  onViewEntries,
  context = 'bone',
  style,
}: {
  challenge: Challenge;
  onEnter: () => void;
  onViewEntries: () => void;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const entered = challenge.mySubmissionPhotoId !== null;
  const closed = challenge.status === 'closed';

  return (
    <Card context={context} level="raised" style={style} padding={spacing.lg}>
      <View style={styles.header}>
        <Eyebrow label={closed ? 'Closed' : 'This week'} context={context} />
        {entered ? <Badge label="Entered" tone="accent" context={context} /> : null}
      </View>

      <Text style={[text.h2, styles.title, { color: c.text }]}>{challenge.title}</Text>

      <Text style={[text.body, styles.prompt, { color: c.textMuted }]}>
        {challenge.prompt}
      </Text>

      <View style={styles.metaRow}>
        <Text style={[text.caption, { color: closed ? c.textFaint : semantic.warning }]}>
          {closed
            ? 'Results are in'
            : `Closes ${countdownLabel(challenge.endsAt)}`}
        </Text>
        <Text style={[text.caption, { color: c.textFaint }]}>
          {challenge.submissionCount === 1
            ? '1 entry'
            : `${challenge.submissionCount} entries`}
        </Text>
      </View>

      {/* Judging method is stated up front. A player who shoots for composition and then
          loses a popular vote has a legitimate complaint if we never said so. */}
      <View style={[styles.judging, { borderTopColor: c.hairline }]}>
        <Text style={[text.caption, { color: c.textFaint }]}>
          {challenge.judging === 'votes'
            ? 'Winner decided by community reactions'
            : 'Winner decided by photo score'}
        </Text>
      </View>

      <View style={styles.actions}>
        {closed ? (
          <Button label="See the winner" variant="secondary" onPress={onViewEntries} />
        ) : (
          <>
            <Button
              label={entered ? 'Change my entry' : 'Enter a photo'}
              onPress={onEnter}
              trailingIcon
            />
            <Button label="See entries" variant="ghost" onPress={onViewEntries} />
          </>
        )}
      </View>
    </Card>
  );
});

/** Compact past-challenge row for the winners rail. */
export const PastChallengeRow = React.memo(function PastChallengeRow({
  challenge,
  onPress,
  context = 'bone',
}: {
  challenge: Challenge;
  onPress: () => void;
  context?: ContextName;
}) {
  const c = contextColors(context);
  const winner = challenge.winningPhoto;

  return (
    <View style={styles.pastRow}>
      <View style={styles.pastText}>
        <Text style={[text.bodySm, { color: c.text }]} numberOfLines={1}>
          {challenge.title}
        </Text>
        <Text style={[text.caption, { color: c.textMuted }]} numberOfLines={1}>
          {winner
            ? `Won by ${winner.author.username} with ${winner.scores.total}`
            : 'No winner — too few entries'}
        </Text>
      </View>

      <Button label="View" variant="ghost" onPress={onPress} />
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: {
    marginTop: spacing.sm,
  },
  prompt: {
    marginTop: spacing.xxs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  judging: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  pastText: {
    flex: 1,
    gap: 1,
  },
});
