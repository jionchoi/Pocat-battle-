import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Icon as PhosphorIcon } from 'phosphor-react-native';

import {
  contextColors,
  icon,
  measure,
  radii,
  spacing,
  text,
  type ContextName,
} from '../theme';
import { Button } from './Button';

/**
 * Composed empty states.
 *
 * An empty screen showing nothing is a wasted moment — each of these says what the screen
 * will contain and gives the one action that fills it. Copy is plain and specific: no
 * exclamation marks, no "Oops", active voice.
 */
export const EmptyState = React.memo(function EmptyState({
  title,
  body,
  Glyph,
  actionLabel,
  onAction,
  context = 'paper',
  compact = false,
  style,
}: {
  title: string;
  body: string;
  Glyph?: PhosphorIcon;
  actionLabel?: string;
  onAction?: () => void;
  context?: ContextName;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <View
      style={[
        styles.wrap,
        { paddingVertical: compact ? spacing.xxl : spacing.huge },
        style,
      ]}
    >
      {Glyph ? (
        <View style={[styles.glyphWell, { backgroundColor: c.sunken }]}>
          <Glyph size={26} color={c.textFaint} weight={icon.weightDefault} />
        </View>
      ) : null}

      <Text style={[text.h2, styles.title, { color: c.text }]}>{title}</Text>
      <Text style={[text.body, styles.body, { color: c.textMuted }]}>{body}</Text>

      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          trailingIcon
          context={context}
          style={styles.action}
        />
      ) : null}
    </View>
  );
});

/**
 * Locked state for a feature that exists but is not yet available.
 *
 * Shown rather than hidden, because a hidden feature teaches the player nothing about what
 * is coming — this states the unlock condition plainly.
 */
export const LockedState = React.memo(function LockedState({
  title,
  requirement,
  context = 'paper',
  style,
}: {
  title: string;
  requirement: string;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <View style={[styles.locked, { backgroundColor: c.sunken }, style]}>
      <Text style={[text.h3, { color: c.textMuted }]}>{title}</Text>
      <Text style={[text.bodySm, { color: c.textFaint, marginTop: spacing.xxs }]}>
        {requirement}
      </Text>
    </View>
  );
});

/** Inline error with a retry. Never an Alert dialog for a recoverable fetch failure. */
export const InlineError = React.memo(function InlineError({
  message,
  onRetry,
  context = 'paper',
  style,
}: {
  message: string;
  onRetry?: () => void;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <View style={[styles.error, { backgroundColor: c.sunken }, style]}>
      <Text style={[text.bodySm, styles.errorText, { color: c.text }]}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" onPress={onRetry} variant="ghost" context={context} />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  glyphWell: {
    width: 60,
    height: 60,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: measure,
  },
  action: {
    marginTop: spacing.lg,
  },
  locked: {
    padding: spacing.md,
    borderRadius: radii.lg,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radii.lg,
  },
  errorText: {
    flex: 1,
  },
});
