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

import { isAvatarUrl, resolveAvatar } from '../constants/avatars';
import {
  avatarRadius,
  contextColors,
  marmalade,
  text,
  type ContextName,
} from '../theme';

/**
 * Avatars are circles by default.
 *
 * They were squircles, on the reasoning that circle avatars read as generic. In this
 * product they read as *photos*: every avatar here sits either on a cat photograph or in
 * a row beside one, and at 36–64pt a rounded square is indistinguishable from a thumbnail
 * of a cat. The round crop is what says "this is a person" — which is the only thing the
 * shape has to communicate. `squircle` stays available for the shop's frame previews.
 *
 * No "egg" placeholder icon. A missing avatar falls back to the player's initials over a
 * tinted surface, which is both more distinctive and more informative.
 *
 * `uri` accepts either a real image URL or a `catframe://avatar/<id>` identity from the
 * built-in set. The scheme is resolved here rather than passed to `<Image>`, which has no
 * handler for it and raises "No suitable URL request handler found".
 */
export const Avatar = React.memo(function Avatar({
  uri,
  name,
  size = 44,
  shape = 'circle',
  context = 'paper',
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

  const swatch = resolveAvatar(uri);

  if (swatch) {
    return (
      <View
        accessible
        accessibilityLabel={name ? `${name}'s avatar` : 'Player avatar'}
        style={[
          styles.fallback,
          { width: size, height: size, borderRadius, backgroundColor: swatch.hue },
          style,
        ]}
      >
        <Text
          style={[
            text.h3,
            { color: '#FFFFFF', fontSize: Math.max(11, size * 0.36) },
          ]}
        >
          {initials || '?'}
        </Text>
      </View>
    );
  }

  // An unresolved `catframe:` URL — a retired avatar id — drops through to initials rather
  // than reaching the image loader, which would throw on the scheme.
  if (uri && !isAvatarUrl(uri)) {
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
        { width: size, height: size, borderRadius, backgroundColor: marmalade[100] },
        style,
      ]}
    >
      <Text
        style={[
          text.h3,
          { color: marmalade[700], fontSize: Math.max(11, size * 0.36) },
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
