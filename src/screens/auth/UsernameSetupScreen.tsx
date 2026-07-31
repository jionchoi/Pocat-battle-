import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { InlineError } from '../../components/EmptyState';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import type { AuthStackParamList } from '../../navigation/types';
import { bone, fern, radii, spacing, text } from '../../theme';
import { useAuthStore } from '../../store/authStore';

/**
 * Trainer name and avatar.
 *
 * Avatars are a fixed set rather than a photo upload: a user-supplied profile image on a
 * social product is a moderation obligation, and this is a cat game.
 */

const AVATARS = [
  { id: 'ember', label: 'Ember', hue: '#A63B2E' },
  { id: 'moss', label: 'Moss', hue: '#2F6B4F' },
  { id: 'slate', label: 'Slate', hue: '#4A6D86' },
  { id: 'brass', label: 'Brass', hue: '#A07A2C' },
  { id: 'mulberry', label: 'Mulberry', hue: '#7C4F6B' },
  { id: 'stone', label: 'Stone', hue: '#8A8078' },
];

type Props = NativeStackScreenProps<AuthStackParamList, 'UsernameSetup'>;

export function UsernameSetupScreen({ navigation }: Props) {
  const user = useAuthStore((s) => s.user);
  const setUsername = useAuthStore((s) => s.setUsername);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);

  const [name, setName] = useState(user?.username ?? '');
  const [avatarId, setAvatarId] = useState(AVATARS[1].id);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const save = useCallback(async () => {
    const trimmed = name.trim();

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
      setFieldError('3 to 20 letters, numbers or underscores.');
      return;
    }

    setFieldError(null);

    try {
      // Avatar identity is stored as a scheme URL the client resolves locally, so no image
      // hosting is involved.
      await setUsername({ username: trimmed, avatarUrl: `catsnap://avatar/${avatarId}` });
      navigation.replace('SignInSignUp');
    } catch {
      // Store holds the message; the banner renders it.
    }
  }, [avatarId, name, navigation, setUsername]);

  const selected = AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0];

  return (
    <Screen scroll clearTabBar={false}>
      <ScreenHeader
        title="Pick a name"
        subtitle="This is what other players see on leaderboards and beside your photos."
      />

      {error ? <InlineError message={error} style={styles.banner} /> : null}

      <View style={styles.preview}>
        <Avatar name={name || 'You'} size={72} />
        <View style={styles.previewText}>
          <Text style={[text.h3, { color: bone.text }]}>{name || 'Your name'}</Text>
          <Text style={[text.bodySm, { color: bone.textMuted }]}>
            {`${selected.label} avatar`}
          </Text>
        </View>
      </View>

      <TextField
        label="Trainer name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. bramble_walks"
        autoCapitalize="none"
        autoCorrect={false}
        error={fieldError ?? undefined}
        style={styles.field}
      />

      <SectionHeader title="Avatar" description="Six to choose from. More in the shop." />

      <View style={styles.grid}>
        {AVATARS.map((avatar) => {
          const active = avatar.id === avatarId;

          return (
            <Pressable
              key={avatar.id}
              onPress={() => setAvatarId(avatar.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${avatar.label} avatar`}
              style={[
                styles.swatchWell,
                {
                  borderColor: active ? fern[600] : bone.hairline,
                  borderWidth: active ? 2 : 1,
                },
              ]}
            >
              <View style={[styles.swatch, { backgroundColor: avatar.hue }]} />
              <Text style={[text.caption, { color: bone.textMuted }]}>
                {avatar.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Start exploring"
        onPress={save}
        loading={busy}
        trailingIcon
        fullWidth
        style={styles.submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  previewText: {
    flex: 1,
    gap: 2,
  },
  field: {
    marginBottom: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatchWell: {
    // Three across on a phone, computed from flexBasis rather than percentage math.
    flexBasis: '30%',
    flexGrow: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
  },
  submit: {
    marginTop: spacing.xxl,
  },
});
