import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, MapPin } from 'phosphor-react-native';
import type { IconProps } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Eyebrow } from '../../components/Badge';
import { Screen } from '../../components/Screen';
import type { AuthStackParamList } from '../../navigation/types';
import {
  AlbumWall,
  MomentCompare,
  NeighbourhoodMap,
  RegularsRow,
  ScoreSheet,
} from './OnboardingArt';
import { marmalade, measure, paper, radii, spacing, text } from '../../theme';
import { requestPermission as requestLocation } from '../../services/location';
import { useCameraPermission } from '../../hooks/useCameraPermission';

/**
 * Onboarding carousel.
 *
 * The permission slides explain why before the OS prompt appears. That ordering matters:
 * on iOS a denied prompt cannot be re-asked in-app, so a cold prompt permanently costs
 * players who would have said yes given a reason.
 *
 * ## Each slide has its own picture, and that is the point
 *
 * This used to be four identical slides — a 72pt glyph in a tinted square, an eyebrow, a
 * title, a paragraph — which is the shape of every onboarding flow ever shipped and showed
 * nothing of the product. An app about photographs and scores had neither anywhere in it,
 * and the two permission slides, which are doing the only irreversible work in the flow,
 * were the least persuasive screens in it.
 *
 * So `art` is a component per slide rather than an icon per slide, and the illustrations live
 * in `OnboardingArt.tsx`. Slide one runs its picture full-bleed behind the type; the other
 * three stack theirs above it. See that file for why none of them reads live data.
 *
 * ## The copy was wrong and is fixed here
 *
 * Slides one and two described an on-device detector that "sees" a cat and starts a
 * countdown. That mechanic was deleted when capture went manual — there is no detector and
 * no countdown — so the app's first four screens were teaching a version of itself that had
 * not existed for weeks. Slide two now says the true thing, and says it as the reason to
 * grant the camera: you choose the moment, and waiting is worth points.
 */

interface Slide {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  /** The illustration above the copy. Slide one draws its own, full-bleed. */
  art?: React.ComponentType;
  /** Sits under the body rather than above it. Slide one's regulars row. */
  footnote?: React.ComponentType;
  permission?: 'camera' | 'location';
  /** Rides in the button's trailing well on a permission slide. */
  icon?: React.ComponentType<IconProps>;
}

const SLIDES: Slide[] = [
  {
    key: 'spot',
    eyebrow: 'Step one',
    title: 'Spot a real cat',
    body: 'Walk your neighbourhood and photograph the cats you meet. Every one you catch goes in your album, and cats you meet twice are recognised.',
    footnote: RegularsRow,
  },
  {
    key: 'camera',
    eyebrow: 'Camera access',
    title: 'You choose the moment',
    body: 'You press the shutter — nothing fires on its own. Waiting for a better moment scores higher than snapping straight away: a mid-yawn beats a sit every time.',
    art: MomentCompare,
    permission: 'camera',
    icon: Camera,
  },
  {
    key: 'location',
    eyebrow: 'Location access',
    title: 'Cats belong to places',
    body: 'Your location puts sightings on the map and lets us recognise the same cat when you meet it again. We store a rounded home area, never your exact address.',
    art: NeighbourhoodMap,
    permission: 'location',
    icon: MapPin,
  },
  {
    key: 'score',
    eyebrow: 'Step two',
    title: 'Every shot gets scored',
    body: 'Composition, how rare the pose is, how unusual the cat is, plus a bonus for great light. Your album stays private until you decide to share a photo.',
    art: ScoreSheet,
  },
];

/**
 * How far down the first slide the album wall reaches.
 *
 * A proportion rather than the canvas's flat 392px: that number was measured on a 844pt
 * artboard, and pinned literally it would eat two thirds of a small phone and leave the
 * title with nowhere to go.
 */
const WALL_RATIO = 0.46;

type Props = NativeStackScreenProps<AuthStackParamList, 'Onboarding'>;

export function OnboardingScreen({ navigation }: Props) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const { width, height } = Dimensions.get('window');
  const insets = useSafeAreaInsets();

  const camera = useCameraPermission();

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      if (next !== index) setIndex(next);
    },
    [index, width]
  );

  const advance = useCallback(() => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToOffset({ offset: (index + 1) * width, animated: true });
      setIndex(index + 1);
      return;
    }
    navigation.replace('SignInSignUp');
  }, [index, navigation, width]);

  const slide = SLIDES[index]!;

  const grant = useCallback(async () => {
    if (slide.permission === 'camera') await camera.request();
    if (slide.permission === 'location') await requestLocation();
    advance();
  }, [advance, camera, slide.permission]);

  const wallHeight = Math.round(height * WALL_RATIO);

  return (
    <Screen padded={false} clearTabBar={false}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index: i }) => {
          const isFirst = i === 0;
          const Art = item.art;
          const Footnote = item.footnote;

          return (
            <View style={{ width }}>
              {isFirst ? <AlbumWall height={wallHeight} /> : null}

              {/*
                Vertical scroll inside a horizontally paged slide.

                The canvas lays these out at 844pt and slides two to four fill it. On a
                smaller phone the bottom of the copy would simply be gone — and it is the
                paragraph explaining a permission, on the screen that asks for it. Scrolling
                is the only honest answer; scaling the type down would break the one scale
                every other screen shares.
              */}
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                  styles.slide,
                  isFirst
                    ? { paddingTop: wallHeight - 36 }
                    : { paddingTop: insets.top + spacing.xxl },
                ]}
              >
                {Art ? (
                  <View style={styles.art}>
                    <Art />
                  </View>
                ) : null}

                <Eyebrow label={item.eyebrow} style={styles.eyebrow} />

                <Text
                  style={[isFirst ? text.display : text.h1, styles.title]}
                  textBreakStrategy="balanced"
                >
                  {item.title}
                </Text>

                <Text style={styles.body}>{item.body}</Text>

                {Footnote ? <Footnote /> : null}
              </ScrollView>
            </View>
          );
        }}
      />

      {/*
        The footer is chrome, not content: it sits outside the pager so it never scrolls, and
        it carries its own top rule and opaque fill so slide one's album wall cannot show
        through behind the button.
      */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View
              key={s.key}
              style={[
                styles.dot,
                {
                  backgroundColor: i === index ? marmalade[600] : paper.hairlineHi,
                  width: i === index ? 18 : 6,
                },
              ]}
            />
          ))}
        </View>

        <Button
          label={
            slide.permission === 'camera'
              ? 'Allow camera'
              : slide.permission === 'location'
                ? 'Allow location'
                : index === SLIDES.length - 1
                  ? 'Get started'
                  : 'Next'
          }
          onPress={slide.permission ? grant : advance}
          /*
           * The canvas draws a naked glyph to the left of the label on the two permission
           * buttons. `Button`'s own rule is that a glyph on a button lives in its trailing
           * well or does not appear at all, so it moves into the well — same glyph, same
           * meaning, and the button keeps the press animation the well is half of.
           */
          trailingIcon
          {...(slide.icon ? { icon: slide.icon } : {})}
          fullWidth
        />

        {slide.permission ? (
          <Button label="Not now" onPress={advance} variant="ghost" fullWidth />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  slide: {
    paddingHorizontal: spacing.xl,
    // Clears the footer, which floats above the pager.
    paddingBottom: spacing.xxxl,
    // Left-aligned rather than centred — a centred onboarding stack is the generic default.
    alignItems: 'flex-start',
  },
  art: {
    alignSelf: 'stretch',
    marginBottom: spacing.lg,
  },
  eyebrow: {
    marginBottom: spacing.sm,
  },
  title: {
    color: paper.text,
    maxWidth: measure,
  },
  body: {
    ...text.body,
    color: paper.textMuted,
    marginTop: spacing.sm,
    maxWidth: measure,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.xs,
    backgroundColor: paper.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: paper.hairlineHi,
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: spacing.sm,
  },
  dot: {
    height: 6,
    borderRadius: radii.full,
  },
});
