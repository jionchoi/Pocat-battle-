import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { ConfirmSheet } from '../../components/BottomSheet';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { showToast } from '../../components/Toast';
import { paper, measure, spacing, text } from '../../theme';
import { clearLocalData } from '../../services/database';
import { useAuthStore } from '../../store/authStore';
import { useAlbumStore } from '../../store/albumStore';
import { useMapStore } from '../../store/mapStore';

/**
 * Privacy and data.
 *
 * Written in plain language, and specific about what is *not* collected — a vague privacy
 * page is worse than none, because it reads as evasion.
 *
 * Deletion is immediate and typed-confirmation gated. It is not a support ticket.
 */

const STORED = [
  {
    label: 'Your account',
    detail:
      'Email or social sign-in identifier, trainer name, avatar choice. Passwords are stored as a bcrypt hash and cannot be read back.',
  },
  {
    label: 'Photos of cats you take',
    detail:
      'Kept so your cards have pictures. Sent once to a vision service to confirm a real cat is in frame, and never posted publicly.',
  },
  {
    label: 'Where each photo was taken',
    detail:
      'The coordinates of a photo, so sightings appear on the map and the same cat can be recognised on a later encounter. Other players see sighting pins but never your account beside them.',
  },
  {
    label: 'A rounded home area',
    detail:
      'One coordinate pair rounded to about a kilometre, used only to place you on a neighbourhood leaderboard. We do not keep a location history.',
  },
  {
    label: 'Game records',
    detail:
      'Your photo scores, your Cat Dex entries and nicknames, challenge entries, reactions you have given, and a log of the XP that determines your Photographer Rank.',
  },
];

const NOT_STORED = [
  'Continuous location tracking or movement history',
  'Your contacts, photo library, or anything else on your device',
  'Advertising identifiers, or data sold or shared with data brokers',
  'Your exact home address',
];

export function PrivacyDataScreen() {
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const busy = useAuthStore((s) => s.busy);

  const resetAlbum = useAlbumStore((s) => s.reset);
  const resetMap = useMapStore((s) => s.reset);

  const [confirmText, setConfirmText] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const canDelete = confirmText.trim().toLowerCase() === 'delete';

  const performDelete = useCallback(async () => {
    setShowConfirm(false);

    try {
      await deleteAccount();
      await clearLocalData().catch(() => undefined);
      resetAlbum();
      resetMap();
      // The root navigator swaps to the auth stack on its own once status changes.
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'We could not delete your account',
        'error'
      );
    }
  }, [deleteAccount, resetAlbum, resetMap]);

  return (
    <Screen scroll>
      <ScreenHeader
        title="Privacy and data"
        subtitle="What we keep, why we keep it, and how to remove all of it."
      />

      <SectionHeader title="What we store" />
      <Card>
        <DividedGroup>
          {STORED.map((item) => (
            <View key={item.label} style={styles.row}>
              <Text style={[text.h3, { color: paper.text }]}>{item.label}</Text>
              <Text style={[text.bodySm, styles.detail]}>{item.detail}</Text>
            </View>
          ))}
        </DividedGroup>
      </Card>

      <SectionHeader title="What we do not store" />
      <Card>
        <View style={styles.list}>
          {NOT_STORED.map((line) => (
            <View key={line} style={styles.bulletRow}>
              <View style={styles.bullet} />
              <Text style={[text.bodySm, styles.detail]}>{line}</Text>
            </View>
          ))}
        </View>
      </Card>

      <SectionHeader title="Who can see your data" />
      <Card>
        <Text style={[text.bodySm, styles.detail]}>
          Other players can see your photographer name, avatar, rank, the photos you shared,
          and up to six showcase cats. They cannot see your email, your Treat balance, your
          full collection, or where any of your cats were caught.
        </Text>
      </Card>

      <SectionHeader
        title="Delete your account"
        description="Immediate and permanent. There is no undo and no waiting period."
      />

      <Card>
        <Text style={[text.bodySm, styles.detail]}>
          Deleting removes your account, every photo, your Cat Dex entries, your reactions and your
          XP ledger. Cats you were the first to photograph stay in other players' Dexes so their
          intact for other players.
        </Text>

        <TextField
          label="Type delete to confirm"
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder="delete"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.confirmField}
        />

        <Button
          label="Delete my account"
          onPress={() => setShowConfirm(true)}
          destructive
          disabled={!canDelete}
          loading={busy}
          fullWidth
        />
      </Card>

      <Text style={[text.caption, styles.footnote]}>
        You can also email support@catframe.app to request a copy of your data.
      </Text>

      <ConfirmSheet
        visible={showConfirm}
        title="Delete everything?"
        body="Your account and all of its data are removed now. This cannot be reversed."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={performDelete}
        onCancel={() => setShowConfirm(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.sm,
    gap: spacing.xxs,
  },
  detail: {
    color: paper.textMuted,
    maxWidth: measure,
  },
  list: {
    gap: spacing.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: paper.textFaint,
    marginTop: 8,
  },
  confirmField: {
    marginTop: spacing.md,
  },
  footnote: {
    color: paper.textFaint,
    marginTop: spacing.xl,
    maxWidth: measure,
  },
});
