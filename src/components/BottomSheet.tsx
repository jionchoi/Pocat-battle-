import React, { useEffect } from 'react';
import {
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

  const Body = scrollable ? ScrollView : View;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
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

            <Body style={scrollable ? styles.scrollBody : undefined}>{children}</Body>
          </View>
        </Animated.View>
      </View>
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
          fullWidth
        />
        <Button
          label={cancelLabel}
          onPress={onCancel}
          variant="secondary"
          context={context}
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
    ...StyleSheet.absoluteFillObject,
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
