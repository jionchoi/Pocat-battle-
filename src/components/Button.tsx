import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ArrowUpRight } from 'phosphor-react-native';

import {
  accentGlow,
  chrome,
  contextColors,
  marmalade,
  icon,
  iconWell,
  press,
  radii,
  semantic,
  spacing,
  text,
  timing,
  useReduceMotion,
  type ContextName,
} from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Committed screen context. Paper (light chrome) or Arena (dark immersive). */
  context?: ContextName;
  /** Renders the nested trailing icon well. Never a naked glyph. */
  trailingIcon?: boolean;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Primary CTA.
 *
 * Implements two mandated patterns:
 *   1. Tactile press — scale 0.98 + translateY 1 on a snap spring, never a color flip.
 *   2. Button-in-button trailing icon — the arrow sits in its own circular well and
 *      translates diagonally while the parent compresses, creating internal kinetic
 *      tension.
 *
 * Only `transform` and `opacity` are animated.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  context = 'paper',
  trailingIcon = false,
  loading = false,
  disabled = false,
  destructive = false,
  fullWidth = false,
  accessibilityHint,
  style,
}: ButtonProps) {
  const c = contextColors(context);
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

  const inert = disabled || loading;

  const onPressIn = useCallback(() => {
    if (inert) return;
    pressed.value = reduceMotion ? 0 : withSpring(1, press.config);
  }, [inert, pressed, reduceMotion]);

  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, press.config);
  }, [pressed]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - (1 - press.scale) * pressed.value },
      { translateY: press.translateY * pressed.value },
    ],
  }));

  const wellStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: iconWell.translateX * pressed.value },
      { translateY: iconWell.translateY * pressed.value },
      { scale: 1 + (iconWell.scale - 1) * pressed.value },
    ],
  }));

  const fillColor = destructive ? semantic.danger : marmalade[600];

  const palette = {
    primary: {
      background: fillColor,
      border: 'transparent',
      foreground: chrome.text,
      well: 'rgba(255, 255, 255, 0.18)',
    },
    secondary: {
      background: context === 'arena' ? c.surface : c.sunken,
      // No border. On the light context the fill is already a step off the page, and a
      // hairline on top of it draws the same edge twice.
      border: 'transparent',
      foreground: destructive ? semantic.danger : c.text,
      well: context === 'arena' ? 'rgba(255,255,255,0.12)' : 'rgba(11,11,12,0.06)',
    },
    ghost: {
      background: 'transparent',
      border: 'transparent',
      // On the arena a ghost button sits over a photograph, where the accent at ghost
      // weight is not reliably legible — it takes the context's own text colour instead.
      foreground: destructive
        ? semantic.danger
        : context === 'arena'
          ? c.textMuted
          : fillColor,
      well: context === 'arena' ? 'rgba(255,255,255,0.12)' : 'rgba(11,11,12,0.06)',
    },
  }[variant];

  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={[fullWidth && styles.fullWidth, style]}
    >
      <Animated.View
        style={[
          styles.body,
          variant === 'ghost' ? styles.bodyGhost : styles.bodyFilled,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            opacity: disabled ? 0.4 : 1,
          },
          // A coral pill dropping a grey shadow looks unlit; the glow is tinted to the
          // button's own hue so it reads as emitting. Suppressed when destructive — a
          // red button that glows is asking to be pressed.
          variant === 'primary' && !disabled && !destructive && accentGlow('button'),
          bodyStyle,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={palette.foreground} />
        ) : (
          <Text
            numberOfLines={1}
            style={[text.h3, styles.label, { color: palette.foreground }]}
          >
            {label}
          </Text>
        )}

        {trailingIcon && !loading ? (
          <Animated.View
            style={[styles.well, { backgroundColor: palette.well }, wellStyle]}
          >
            <ArrowUpRight
              size={icon.size.sm}
              color={palette.foreground}
              weight={icon.weightDefault}
            />
          </Animated.View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fullWidth: {
    alignSelf: 'stretch',
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
  },
  bodyFilled: {
    /** Primary CTAs are fully rounded pills with generous padding. */
    borderRadius: radii.full,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.xl,
    /** Trailing well sits flush inside the right inner padding. */
    paddingRight: spacing.xs,
    minHeight: 52,
  },
  bodyGhost: {
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 44,
  },
  label: {
    /** Sentence case. Never Title Case On Every Button. */
    textAlign: 'center',
  },
  well: {
    width: iconWell.size,
    height: iconWell.size,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Skeleton matching Button's exact geometry, so nothing jumps when the real control
 * mounts. Circular spinners as a general loading treatment are banned; this is the
 * replacement.
 */
export const ButtonSkeleton = React.memo(function ButtonSkeleton({
  context = 'paper',
  fullWidth = false,
}: {
  context?: ContextName;
  fullWidth?: boolean;
}) {
  const c = contextColors(context);
  const shimmer = useSharedValue(0.5);
  const reduceMotion = useReduceMotion();

  React.useEffect(() => {
    if (reduceMotion) return;
    shimmer.value = withTiming(1, timing.enter);
  }, [reduceMotion, shimmer]);

  const animated = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height: 52,
          borderRadius: radii.full,
          backgroundColor: c.sunken,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          minWidth: fullWidth ? undefined : 160,
        },
        animated,
      ]}
    />
  );
});
