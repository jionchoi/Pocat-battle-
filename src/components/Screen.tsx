import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import {
  contextColors,
  layout,
  measure,
  sectionPadding,
  spacing,
  text,
  type ContextName,
} from '../theme';

/**
 * Screen shell.
 *
 * Every screen commits to one context for its whole surface — no light card floating on an
 * Arena screen, no dark strip inside a Bone screen. Centralising that here is what keeps
 * the rule from quietly eroding screen by screen.
 *
 * `tabBarClearance` is added to scroll content so the floating tab bar never covers the
 * last row of a list.
 */
export function Screen({
  children,
  context = 'bone',
  scroll = false,
  padded = true,
  clearTabBar = true,
  refreshControl,
  contentStyle,
  style,
}: {
  children: React.ReactNode;
  context?: ContextName;
  scroll?: boolean;
  padded?: boolean;
  clearTabBar?: boolean;
  refreshControl?: React.ReactElement;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const insets = useSafeAreaInsets();

  const padding = {
    paddingTop: insets.top + (padded ? spacing.xs : 0),
    paddingHorizontal: padded ? layout.gutter : 0,
    paddingBottom: clearTabBar ? layout.tabBarClearance : insets.bottom,
  };

  if (scroll) {
    return (
      <View style={[styles.root, { backgroundColor: c.bg }, style]}>
        <StatusBar style={context === 'arena' ? 'light' : 'dark'} />
        <ScrollView
          contentContainerStyle={[padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bg }, padding, style]}>
      <StatusBar style={context === 'arena' ? 'light' : 'dark'} />
      {children}
    </View>
  );
}

/** Section heading. Title and description sit outside their content, gallery-style. */
export const SectionHeader = React.memo(function SectionHeader({
  title,
  description,
  action,
  context = 'bone',
  style,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionRow}>
        <Text style={[text.h2, styles.sectionTitle, { color: c.text }]}>{title}</Text>
        {action}
      </View>
      {description ? (
        <Text style={[text.bodySm, styles.sectionBody, { color: c.textMuted }]}>
          {description}
        </Text>
      ) : null}
    </View>
  );
});

/** Screen title block with an optional eyebrow above it. */
export const ScreenHeader = React.memo(function ScreenHeader({
  title,
  subtitle,
  right,
  context = 'bone',
  style,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);

  return (
    <View style={[styles.header, style]}>
      <View style={styles.headerRow}>
        <Text
          style={[text.h1, styles.headerTitle, { color: c.text }]}
          // Android balances the break; iOS relies on preventOrphan() at the call site.
          textBreakStrategy="balanced"
        >
          {title}
        </Text>
        {right}
      </View>
      {subtitle ? (
        <Text style={[text.body, styles.sectionBody, { color: c.textMuted }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    ...sectionPadding(spacing.sm),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerTitle: {
    flex: 1,
  },
  section: {
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    flexShrink: 1,
  },
  sectionBody: {
    marginTop: spacing.xxs,
    maxWidth: measure,
  },
});
