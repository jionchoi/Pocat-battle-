import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import {
  contextColors,
  marmalade,
  radii,
  semantic,
  spacing,
  text,
  type ContextName,
} from '../theme';

/**
 * Text input.
 *
 * Layout follows the form rule: label above the input, helper text present in the markup
 * even when empty (so the row height does not jump when an error appears), error text
 * below.
 *
 * The focus ring is explicit because Android silently drops the platform default inside a
 * custom-styled input, and a keyboard user needs to see where they are.
 */
export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  helper?: string;
  error?: string;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}

export const TextField = React.memo(function TextField({
  label,
  helper,
  error,
  context = 'paper',
  style,
  ...inputProps
}: TextFieldProps) {
  const c = contextColors(context);
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? semantic.danger
    : focused
      ? marmalade[500]
      : c.hairlineHi;

  return (
    <View style={style}>
      <Text style={[text.bodySm, styles.label, { color: c.textMuted }]}>{label}</Text>

      <View
        style={[
          styles.well,
          {
            backgroundColor: c.sunken,
            borderColor,
            // 2px on focus rather than a colour-only change, so the state is visible
            // without relying on colour perception.
            borderWidth: focused || error ? 2 : 1,
          },
        ]}
      >
        <TextInput
          {...inputProps}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={label}
          accessibilityHint={error ?? helper}
          style={[text.body, styles.input, { color: c.text }]}
        />
      </View>

      {/* Reserved space, so an appearing error does not shift the fields below it. */}
      <Text
        style={[
          text.caption,
          styles.helper,
          { color: error ? semantic.danger : c.textFaint },
        ]}
      >
        {error ?? helper ?? ' '}
      </Text>
    </View>
  );
});

/** Search input for the collection and friend search. */
export const SearchField = React.memo(function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  context = 'paper',
  style,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.searchWell,
        {
          backgroundColor: c.sunken,
          borderColor: focused ? marmalade[500] : c.hairline,
          borderWidth: focused ? 2 : 1,
        },
        style,
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={[text.body, styles.searchInput, { color: c.text }]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs,
  },
  well: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
  },
  input: {
    height: 48,
    padding: 0,
  },
  helper: {
    marginTop: spacing.xxs,
    minHeight: 16,
  },
  searchWell: {
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    height: 44,
    padding: 0,
  },
});
