import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, DividedGroup } from '../../components/Card';
import { ConfirmSheet } from '../../components/BottomSheet';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { showToast } from '../../components/Toast';
import { authApi } from '../../api/endpoints';
import type { ProfileStackParamList } from '../../navigation/types';
import { bone, fern, measure, spacing, text } from '../../theme';
import { clearLocalData } from '../../services/database';
import { useAuthStore } from '../../store/authStore';
import { useAlbumStore } from '../../store/albumStore';
import { useMapStore } from '../../store/mapStore';

/**
 * Settings.
 *
 * Hairline-separated rows rather than a stack of cards — grouping by structure is the rule
 * for a list like this.
 *
 * Sign-out clears the local SQLite cache. Leaving one account's album on the device after
 * another person signs in would be a real leak, not a cosmetic bug.
 */

type Props = NativeStackScreenProps<ProfileStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const resetAlbum = useAlbumStore((s) => s.reset);
  const resetMap = useMapStore((s) => s.reset);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then(({ granted }) => setPushEnabled(granted))
      .catch(() => undefined);
  }, []);

  /**
   * Registering a push token requires permission first. If it is permanently denied, the
   * only route is the system settings app — the switch says so rather than silently failing.
   */
  const togglePush = useCallback(
    async (next: boolean) => {
      setPushBusy(true);

      try {
        if (!next) {
          setPushEnabled(false);
          showToast('Notifications will stop after you turn them off in system settings');
          await Linking.openSettings();
          return;
        }

        const current = await Notifications.getPermissionsAsync();

        if (!current.granted && !current.canAskAgain) {
          showToast('Turn notifications on for CatSnap in system settings', 'neutral');
          await Linking.openSettings();
          return;
        }

        const result = current.granted
          ? current
          : await Notifications.requestPermissionsAsync();

        if (!result.granted) {
          setPushEnabled(false);
          return;
        }

        const token = await Notifications.getExpoPushTokenAsync();
        await authApi.setPushToken(token.data);

        setPushEnabled(true);
        showToast('Notifications on', 'success');
      } catch {
        showToast('We could not turn notifications on', 'error');
      } finally {
        setPushBusy(false);
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    setConfirmSignOut(false);

    // Clear device state before dropping the session, so nothing is left keyed to a user id
    // the app no longer knows.
    await clearLocalData().catch(() => undefined);
    resetAlbum();
    resetMap();
    await logout();
  }, [logout, resetAlbum, resetMap]);

  return (
    <Screen scroll>
      <ScreenHeader title="Settings" />

      <SectionHeader title="Notifications" />
      <Card>
        <View style={styles.switchRow}>
          <View style={styles.switchBody}>
            <Text style={[text.body, { color: bone.text }]}>Push notifications</Text>
            <Text style={[text.caption, styles.hint]}>
              Challenge results, reactions to your photos, and rare cats spotted nearby.
            </Text>
          </View>
          <Switch
            value={pushEnabled}
            onValueChange={(next) => void togglePush(next)}
            disabled={pushBusy}
            trackColor={{ true: fern[500], false: bone.hairlineHi }}
            thumbColor={Platform.OS === 'android' ? fern[700] : undefined}
            accessibilityLabel="Push notifications"
          />
        </View>
      </Card>

      <SectionHeader title="Privacy and location" />
      <Card>
        <DividedGroup>
          <Row
            label="What we store and why"
            detail="Plain-language explanation, plus how to delete everything."
            onPress={() => navigation.navigate('PrivacyData')}
          />
          <Row
            label="Location permissions"
            detail="Managed by your device."
            onPress={() => void Linking.openSettings()}
          />
        </DividedGroup>
      </Card>

      <SectionHeader title="Subscription" />
      <Card>
        <DividedGroup>
          <Row
            label="CatSnap Pro"
            detail={
              user?.proSubscriptionActive
                ? 'Active. Manage it in your store account.'
                : 'Not active.'
            }
            onPress={() => navigation.navigate('Shop')}
            trailing={
              user?.proSubscriptionActive ? (
                <Badge label="Active" tone="accent" />
              ) : undefined
            }
          />
        </DividedGroup>
      </Card>

      <SectionHeader title="Account" />
      <Card>
        <DividedGroup>
          <Row
            label="Trainer name"
            detail={user?.username ?? ''}
            onPress={() => showToast('Renaming is coming in a later build', 'neutral')}
          />
          <Row
            label="Email"
            detail={user?.email ?? 'Signed in with a social account'}
          />
        </DividedGroup>
      </Card>

      <SectionHeader title="Support" />
      <Card>
        <DividedGroup>
          <Row
            label="Contact us"
            detail="support@catsnap.app"
            onPress={() =>
              void Linking.openURL(
                'mailto:support@catsnap.app?subject=CatSnap%20support'
              )
            }
          />
          <Row label="Version" detail="0.1.0" />
        </DividedGroup>
      </Card>

      <View style={styles.footer}>
        <Button
          label="Sign out"
          onPress={() => setConfirmSignOut(true)}
          variant="secondary"
          fullWidth
        />
        <Text style={[text.caption, styles.legal]}>
          Signing out removes your album from this device. It stays on our servers and
          comes back when you sign in again.
        </Text>
      </View>

      <ConfirmSheet
        visible={confirmSignOut}
        title="Sign out?"
        body="Your album is cleared from this device and restored when you sign back in."
        confirmLabel="Sign out"
        onConfirm={signOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Screen>
  );
}

const Row = React.memo(function Row({
  label,
  detail,
  onPress,
  trailing,
}: {
  label: string;
  detail?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${label}. ${detail ?? ''}` : undefined}
      style={styles.row}
    >
      <View style={styles.rowBody}>
        <Text style={[text.body, { color: bone.text }]}>{label}</Text>
        {detail ? (
          <Text style={[text.caption, styles.hint]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Container>
  );
});

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  switchBody: {
    flex: 1,
    gap: 2,
  },
  hint: {
    color: bone.textMuted,
    maxWidth: measure,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  footer: {
    marginTop: spacing.xxl,
    gap: spacing.sm,
  },
  legal: {
    color: bone.textFaint,
    maxWidth: measure,
  },
});
