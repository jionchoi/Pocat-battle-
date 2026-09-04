import React, { useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'phosphor-react-native';

import {
  contextColors,
  elevation,
  hitSlopFor,
  icon,
  radii,
  spacing,
  spring,
  text,
  timing,
  useReduceMotion,
  type ContextName,
} from '../theme';
import { Button } from './Button';

/**
 * Bottom sheet and modal.
 *
 * Preferred over a centred dialog for anything with content — a sheet keeps the player's
 * context visible behind it. Simple confirmations still use `ConfirmSheet` rather than
 * `Alert.alert`, so the copy and styling stay ours.
 */

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  context?: ContextName;
  /** Sheets with long content scroll internally rather than growing past the screen. */
  scrollable?: boolean;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  context = 'paper',
  scrollable = false,
}: BottomSheetProps) {
  const c = contextColors(context);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = reduceMotion ? 1 : withSpring(1, spring.soft);
    } else {
      progress.value = reduceMotion ? 0 : withTiming(0, timing.exit);
    }
  }, [progress, reduceMotion, visible]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const sheetStyle = useAnimatedStyle(() => ({
    // translateY only — animating height would trigger layout every frame.
    transform: [{ translateY: (1 - progress.value) * 420 }],
  }));

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/*
        Lifted clear of the keyboard.

        A sheet is pinned to the bottom of the screen, which is exactly where a keyboard
        appears — so any sheet containing a text field was completely covered by it the
        moment the field took focus. "Name this cat" was unusable: the player could type,
        but could not see the field or reach the button that submits it.

        `padding` on iOS rather than `height`, because the sheet is laid out by
        `justifyContent: flex-end` and shrinking the container is what moves it up. Android
        resizes the window itself under the default `adjustResize`, so it needs nothing and
        adding it would move the sheet twice.
      */}
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[styles.scrim, { backgroundColor: c.scrim }, scrimStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel="Close"
            accessibilityRole="button"
          />
        </Animated.View>

        <Animated.View
          // Screen readers must not reach the content behind an open sheet.
          accessibilityViewIsModal
          style={[
            styles.sheetShell,
            {
              backgroundColor: c.bg,
              paddingBottom: insets.bottom + spacing.xs,
            },
            elevation('modal', context),
            sheetStyle,
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: c.hairlineHi }]} />

          <View style={styles.sheetCore}>
            {title ? (
              <View style={styles.header}>
                <Text style={[text.h2, { color: c.text, flex: 1 }]}>{title}</Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={hitSlopFor(24)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={icon.size.md} color={c.textMuted} weight={icon.weightDefault} />
                </Pressable>
              </View>
            ) : null}

            {/*
              `keyboardShouldPersistTaps` matters on the scrollable branch and only there:
              without it the first tap on a button while the keyboard is up is swallowed to
              dismiss the keyboard, so submitting a name takes two taps and the first one
              looks like the button is broken.
            */}
            {scrollable ? (
              <ScrollView
                style={styles.scrollBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View>{children}</View>
            )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

/**
 * Confirmation sheet. Replaces `Alert.alert` so destructive copy and the danger styling
 * stay under our control rather than the platform's.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  busy = false,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  context = 'paper',
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /**
   * True while the confirmed action is running.
   *
   * The confirm button becomes the paw trail and the cancel goes inert, because a destructive
   * action that takes a network round trip left this sheet looking untouched — the same two
   * buttons, no motion, nothing saying the tap landed. The usual answer to that was to swap
   * the label to a present participle ("Deleting"), which is a word where a control should be.
   */
  busy?: boolean;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  context?: ContextName;
}) {
  const c = contextColors(context);

  return (
    <BottomSheet visible={visible} onClose={onCancel} title={title} context={context}>
      <Text style={[text.body, { color: c.textMuted, marginBottom: spacing.lg }]}>
        {body}
      </Text>

      <View style={styles.confirmActions}>
        <Button
          label={confirmLabel}
          onPress={onConfirm}
          destructive={destructive}
          context={context}
          loading={busy}
          disabled={busy}
          fullWidth
        />
        <Button
          label={cancelLabel}
          onPress={onCancel}
          variant="secondary"
          context={context}
          // Inert rather than hidden: the sheet keeps its shape while the work runs, and a
          // cancel that cannot stop what has already been sent should not pretend it can.
          disabled={busy}
          fullWidth
        />
      </View>
    </BottomSheet>
  );
}

const SHEET_RADIUS = radii.xxl;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
  /**
   * One surface, not a shell wrapping a core. The sheet already separates itself from
   * what is behind it with a scrim and a modal-weight shadow; a second inner panel inside
   * that was drawing a boundary the scrim had already drawn.
   */
  sheetShell: {
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    paddingTop: spacing.xs,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: radii.full,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  sheetCore: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  scrollBody: {
    maxHeight: 420,
  },
  confirmActions: {
    gap: spacing.xs,
  },
});
