import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  avatarRadius,
  contextColors,
  fern,
  text,
  type ContextName,
} from '../theme';

/**
 * Avatars are squircles by default — circle-only avatars read as generic. `circle` stays
 * available for the few places a round crop is genuinely right, such as an author chip
 * sitting on a photo.
 *
 * No "egg" placeholder icon. A missing avatar falls back to the player's initials over a
 * tinted surface, which is both more distinctive and more informative.
 */
export const Avatar = React.memo(function Avatar({
  uri,
  name,
  size = 44,
  shape = 'squircle',
  context = 'bone',
  style,
}: {
  uri?: string | null;
  name?: string;
  size?: number;
  shape?: 'squircle' | 'circle';
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  const borderRadius =
    shape === 'circle' ? avatarRadius.circle : Math.min(avatarRadius.squircle, size * 0.32);

  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        accessible
        accessibilityLabel={name ? `${name}'s avatar` : 'Player avatar'}
        style={[
          { width: size, height: size, borderRadius, backgroundColor: c.sunken },
          style as StyleProp<ImageStyle>,
        ]}
      />
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={name ? `${name}'s avatar` : 'Player avatar'}
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius, backgroundColor: fern[100] },
        style,
      ]}
    >
      <Text
        style={[
          text.h3,
          { color: fern[700], fontSize: Math.max(11, size * 0.36) },
        ]}
      >
        {initials || '?'}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
