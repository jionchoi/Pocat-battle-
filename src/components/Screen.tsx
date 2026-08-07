import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useNavigation, useNavigationState } from '@react-navigation/native';

import { CaretLeft, type IconProps } from 'phosphor-react-native';

import {
  contextColors,
  hitSlopFor,
  layout,
  marmalade,
  measure,
  sectionPadding,
  spacing,
  text,
  type ContextName,
} from '../theme';
import { Grain } from './Grain';
import { PawRefreshIndicator } from './PawRefresh';

/**
 * Screen shell.
 *
 * Every screen commits to one context for its whole surface — no light card floating on an
 * Arena screen, no dark strip inside a paper screen. Centralising that here is what keeps
 * the rule from quietly eroding screen by screen.
 *
 * The grain sits here rather than in each screen: it is a property of the surface, and one
 * screen that forgets it is immediately visible as a flat patch next to its neighbours.
 * It mounts behind `children` and outside the ScrollView, so it never repaints on scroll.
 *
 * `tabBarClearance` is added to scroll content so the floating tab bar never covers the
 * last row of a list.
 */
export function Screen({
  children,
  context = 'paper',
  scroll = false,
  padded = true,
  clearTabBar = true,
  bleed = false,
  grain,
  refreshControl,
  refreshing = false,
  refreshIndicatorOffset,
  contentStyle,
  style,
}: {
  children: React.ReactNode;
  context?: ContextName;
  scroll?: boolean;
  padded?: boolean;
  clearTabBar?: boolean;
  /**
   * Hands the safe-area insets to the child instead of applying them here.
   *
   * For a screen that brings its own scroller. The padding below is applied to a *view
   * wrapping* the child, which for a list means the list's viewport stops at the insets:
   * rows are clipped at the notch and above the home indicator, leaving a band of bare
   * background at each end that content can never scroll into. A `scroll` screen does not
   * have this problem because its padding goes on the scroll content, not the scroller.
   *
   * With `bleed`, the child fills the window and owns its own insets — normally by adding
   * `insets.top` to its content padding, which puts the first row in the same place while
   * letting it scroll under the status bar.
   */
  bleed?: boolean;
  /**
   * Defaults to on for the arena and off for the light context.
   *
   * Grain earns its cost on the arena, where it breaks up banding in the dark gradient
   * behind the score. On a white page it does not: dots on white read as dirt rather
   * than as tooth, and it was mounting an SVG overlay on every screen to render a
   * texture nobody could see.
   */
  grain?: boolean;
  /**
   * React 19 narrowed `ReactElement`'s default props type from `any` to `unknown`, so a
   * bare `React.ReactElement` no longer satisfies ScrollView's `refreshControl`. Naming
   * the props type is both the fix and more honest about what belongs here.
   */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /**
   * Whether a pull-to-refresh is running.
   *
   * Paired with `pawRefreshControl`, which hides the platform spinner: this is what puts
   * the paws in the space it leaves behind. The flag lives here rather than inside the
   * control because the indicator has to be a sibling of the scroller, not a child of it.
   */
  refreshing?: boolean;
  /**
   * How far below the safe area those paws sit.
   *
   * Defaults to a hair, which is where the gap opens on a screen whose header scrolls with
   * its content. A screen with a *fixed* header above its list opens the gap below that
   * header instead, and passes its height here.
   */
  refreshIndicatorOffset?: number;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const insets = useSafeAreaInsets();
  const showGrain = grain ?? context === 'arena';

  const padding = bleed
    ? undefined
    : {
        paddingTop: insets.top + (padded ? spacing.xs : 0),
        paddingHorizontal: padded ? layout.gutter : 0,
        paddingBottom: clearTabBar ? layout.tabBarClearance : insets.bottom,
      };

  const indicator = (
    <PawRefreshIndicator
      refreshing={refreshing}
      top={insets.top + (refreshIndicatorOffset ?? spacing.xs)}
    />
  );

  if (scroll) {
    return (
      <View style={[styles.root, { backgroundColor: c.bg }, style]}>
        <StatusBar style={context === 'arena' ? 'light' : 'dark'} />
        {showGrain ? <Grain context={context} /> : null}
        {indicator}
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
    <View style={[styles.root, { backgroundColor: c.bg }, style]}>
      <StatusBar style={context === 'arena' ? 'light' : 'dark'} />
      {showGrain ? <Grain context={context} /> : null}
      {indicator}
      <View style={[styles.root, padding]}>{children}</View>
    </View>
  );
}

/**
 * Section heading. Title and description sit outside their content, gallery-style.
 *
 * Set at `h3` rather than `h2`: these headings label a band within a screen that already
 * has a title, and at 20pt they competed with it. The optional glyph is what carries the
 * emphasis instead — a small accent mark beside 15pt bold reads louder than 20pt plain,
 * and costs no vertical space.
 *
 * `size="lg"` is the exception, for a screen with **no title of its own** — the feed opens
 * on a wordmark, so "Trending now" and "For you" are the only headings on it and there is
 * nothing above them left to compete with. They are the screen's structure rather than a
 * label inside it, so they run at display size.
 */
export const SectionHeader = React.memo(function SectionHeader({
  title,
  description,
  Glyph,
  glyphColor,
  action,
  size = 'md',
  context = 'paper',
  style,
}: {
  title: string;
  description?: string;
  Glyph?: React.ComponentType<IconProps>;
  glyphColor?: string;
  action?: React.ReactNode;
  /** `lg` is for screens with no `ScreenHeader` above them. See the note above. */
  size?: 'md' | 'lg';
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const large = size === 'lg';

  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionRow}>
        <View style={styles.sectionTitleRow}>
          {Glyph ? (
            <Glyph
              size={large ? 22 : 15}
              weight="fill"
              color={glyphColor ?? marmalade[600]}
            />
          ) : null}
          <Text
            style={[large ? text.h1 : text.h3, styles.sectionTitle, { color: c.text }]}
          >
            {title}
          </Text>
        </View>
        {action}
      </View>
      {description ? (
        <Text
          style={[
            large ? text.body : text.bodySm,
            styles.sectionBody,
            { color: c.textMuted },
          ]}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
});

/**
 * The Cat Frame wordmark. Two words, two colours, no logotype file.
 *
 * The accent falls on the second word rather than the first because "Cat" is the noun
 * every competing app also owns — "Frame" is the part that says what this one does, and
 * it says it twice over: the frame you compose the shot in, and the frame you keep it in.
 */
export const Wordmark = React.memo(function Wordmark({
  size = 22,
  context = 'paper',
}: {
  size?: number;
  context?: ContextName;
}) {
  const c = contextColors(context);

  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel="Cat Frame"
      style={[text.h1, { fontSize: size, lineHeight: size * 1.05, color: c.text }]}
    >
      Cat<Text style={{ color: marmalade[600] }}> Frame</Text>
    </Text>
  );
});

/**
 * Whether this screen sits on top of another one in its own stack.
 *
 * Deliberately not `navigation.canGoBack()`: that walks up to parent navigators, so on a
 * tab root it can answer "yes" because some ancestor has history — and a back arrow on a
 * tab root points somewhere the player never asked to go. The nearest stack's own index
 * is exactly the question being asked.
 */
export function useIsPushed(): boolean {
  return useNavigationState((state) => state?.type === 'stack' && state.index > 0);
}

/**
 * The back chevron.
 *
 * Exported for the handful of screens that lead with something other than a title — a
 * public profile opens with an avatar, and a photo opens with the photograph — and so
 * cannot get their chevron from `ScreenHeader`.
 */
export const BackButton = React.memo(function BackButton({
  onPress,
  context = 'paper',
  style,
}: {
  onPress?: () => void;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  const navigation = useNavigation();

  return (
    <Pressable
      onPress={onPress ?? (() => navigation.goBack())}
      hitSlop={hitSlopFor(28)}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      style={[styles.back, style]}
    >
      <CaretLeft size={22} weight="bold" color={c.text} />
    </Pressable>
  );
});

/**
 * Screen title block.
 *
 * The eyebrow is a bare wide-tracked mono line rather than a tinted pill. Against a heavy
 * grotesk title, a pill competes: two enclosed shapes stacked on each other read as two
 * headings. A rule of small monospaced capitals reads as a category, which is what it is.
 *
 * ## The back chevron appears on its own
 *
 * Native headers are off across the whole product (see RootNavigator), so every screen
 * draws its own title — which means every screen could forget its own way back. Rather
 * than trust twelve call sites to remember, the chevron is derived: if this screen was
 * *pushed* onto a stack, it gets one.
 *
 * The check is the nearest navigator's own index, not `navigation.canGoBack()`. That
 * method walks up to parent navigators, so on a tab root it can answer "yes" because some
 * ancestor has history — and a back arrow on a tab root points nowhere the player asked
 * to go. `state.index > 0` on a stack is exactly "there is a screen underneath this one".
 *
 * `back` overrides the inference in both directions for the rare screen that needs it.
 */
export const ScreenHeader = React.memo(function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  right,
  back,
  onBack,
  context = 'paper',
  style,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Force the chevron on or off. Defaults to "on when this screen was pushed". */
  back?: boolean;
  /** Custom back behaviour. Defaults to `goBack()`. */
  onBack?: () => void;
  context?: ContextName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = contextColors(context);
  // Called unconditionally — `back ?? useIsPushed()` would short-circuit the hook.
  const pushed = useIsPushed();
  const showBack = back ?? pushed;

  return (
    <View style={[styles.header, style]}>
      {eyebrow ? (
        <Text style={[text.eyebrow, styles.eyebrow, { color: c.textFaint }]}>
          {eyebrow}
        </Text>
      ) : null}
      <View style={styles.headerRow}>
        {showBack ? <BackButton onPress={onBack} context={context} /> : null}
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
  eyebrow: {
    marginBottom: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  /**
   * Pulled left by the chevron's own side bearing so the *glyph* aligns with the screen
   * gutter, not the box around it. Optical alignment — a chevron whose bounding box is
   * flush looks indented.
   */
  back: {
    marginLeft: -6,
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
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  sectionTitle: {
    flexShrink: 1,
  },
  sectionBody: {
    marginTop: spacing.xxs,
    maxWidth: measure,
  },
});
