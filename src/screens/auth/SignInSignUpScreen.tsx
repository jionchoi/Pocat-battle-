import React, { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Screen, ScreenHeader } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { InlineError } from '../../components/EmptyState';
import type { AuthStackParamList } from '../../navigation/types';
import { paper, measure, spacing, text } from '../../theme';
import { useAuthStore } from '../../store/authStore';

/**
 * Sign in / sign up.
 *
 * Apple Sign-In is shown on iOS whenever any other social provider is offered — App Store
 * review guideline 4.8 makes it mandatory, and a build without it gets rejected.
 *
 * Validation is inline beneath each field. No `Alert.alert` for a bad email.
 */

type Props = NativeStackScreenProps<AuthStackParamList, 'SignInSignUp'>;

type Mode = 'signin' | 'signup';

export function SignInSignUpScreen({ navigation }: Props) {
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const validate = useCallback((): boolean => {
    const next: Record<string, string> = {};

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Enter a valid email address.';
    }
    if (mode === 'signup' && password.length < 10) {
      next.password = 'Use at least 10 characters.';
    }
    if (mode === 'signin' && password.length === 0) {
      next.password = 'Enter your password.';
    }
    if (mode === 'signup' && !/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) {
      next.username = '3 to 20 letters, numbers or underscores.';
    }

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }, [email, mode, password, username]);

  const submit = useCallback(async () => {
    clearError();
    if (!validate()) return;

    try {
      if (mode === 'signup') {
        // No navigation here: signing up authenticates, and the root navigator sends a
        // fresh account to the avatar step. Replacing a screen on a stack that is being
        // unmounted in the same commit is how that step got skipped.
        await signup({ email: email.trim(), password, username: username.trim() });
      } else {
        await login({ email: email.trim(), password });
      }
    } catch {
      // The store already holds the message; the banner below renders it.
    }
  }, [clearError, email, login, mode, navigation, password, signup, username, validate]);

  const switchMode = useCallback(() => {
    clearError();
    setFieldErrors({});
    setMode((m) => (m === 'signup' ? 'signin' : 'signup'));
  }, [clearError]);

  return (
    <Screen scroll clearTabBar={false}>
      <ScreenHeader
        title={mode === 'signup' ? 'Make an account' : 'Welcome back'}
        subtitle={
          mode === 'signup'
            ? 'Your collection syncs across devices, so a lost phone does not lose your cats.'
            : 'Sign in to reach your album and your Cat Dex.'
        }
      />

      {error ? (
        <InlineError message={error} style={styles.banner} />
      ) : null}

      <View style={styles.form}>
        {mode === 'signup' ? (
          <TextField
            label="Trainer name"
            value={username}
            onChangeText={setUsername}
            placeholder="e.g. bramble_walks"
            autoCapitalize="none"
            autoCorrect={false}
            error={fieldErrors.username}
            helper="Other players see this on leaderboards."
          />
        ) : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          error={fieldErrors.email}
        />

        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'}
          secureTextEntry
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          error={fieldErrors.password}
        />

        <Button
          label={mode === 'signup' ? 'Create account' : 'Sign in'}
          onPress={submit}
          loading={busy}
          trailingIcon
          fullWidth
          style={styles.submit}
        />
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={[text.caption, { color: paper.textFaint }]}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.social}>
        {/*
          Social sign-in needs expo-auth-session (Google) and expo-apple-authentication
          (Apple) plus configured client ids. The backend route (/auth/social) is ready and
          verifies both providers' ID tokens. These buttons are disabled rather than absent
          so the flow is visible and cannot be mistaken for missing.
        */}
        {Platform.OS === 'ios' ? (
          <Button
            label="Continue with Apple"
            onPress={() => undefined}
            variant="secondary"
            disabled
            fullWidth
          />
        ) : null}

        <Button
          label="Continue with Google"
          onPress={() => undefined}
          variant="secondary"
          disabled
          fullWidth
        />

        <Text style={[text.caption, styles.socialNote]}>
          Social sign-in needs store credentials before it can be switched on.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          label={
            mode === 'signup' ? 'I already have an account' : 'I need an account'
          }
          onPress={switchMode}
          variant="ghost"
          fullWidth
        />

        <Text style={[text.caption, styles.legal]}>
          By continuing you agree to our terms and privacy policy. You can delete your
          account and all of its data at any time from Settings.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: spacing.md,
  },
  form: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  submit: {
    marginTop: spacing.xs,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: paper.hairlineHi,
  },
  social: {
    gap: spacing.xs,
  },
  socialNote: {
    color: paper.textFaint,
    marginTop: spacing.xxs,
  },
  footer: {
    marginTop: spacing.xxl,
    gap: spacing.sm,
  },
  legal: {
    color: paper.textFaint,
    maxWidth: measure,
  },
});
