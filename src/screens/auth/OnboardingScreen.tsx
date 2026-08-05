import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Camera, MapPin, PawPrint, Trophy } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Eyebrow } from '../../components/Badge';
import { Screen } from '../../components/Screen';
import type { AuthStackParamList } from '../../navigation/types';
import {
  paper,
  marmalade,
  icon,
  measure,
  radii,
  spacing,
  text,
} from '../../theme';
import { requestPermission as requestLocation } from '../../services/location';
import { useCameraPermission } from '../../hooks/useCameraPermission';

/**
 * Onboarding carousel.
 *
 * The permission slides explain why before the OS prompt appears. That ordering matters:
 * on iOS a denied prompt cannot be re-asked in-app, so a cold prompt permanently costs
 * players who would have said yes given a reason.
 */

interface Slide {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  Glyph: typeof PawPrint;
  permission?: 'camera' | 'location';
}

const SLIDES: Slide[] = [
  {
    key: 'spot',
    eyebrow: 'Step one',
    title: 'Spot a real cat',
    body: 'Walk your neighbourhood. When the camera sees a cat, you get a few seconds to frame the shot before it moves on.',
    Glyph: PawPrint,
  },
  {
    key: 'camera',
    eyebrow: 'Camera access',
    title: 'Timing is the whole game',
    body: 'The camera watches for a cat and starts a short countdown. Waiting for a better moment scores higher than snapping straight away — a mid-yawn beats a sit every time.',
    Glyph: Camera,
    permission: 'camera',
  },
  {
    key: 'location',
    eyebrow: 'Location access',
    title: 'Cats belong to places',
    body: 'Your location puts sightings on the map and lets us recognise the same cat when you meet it again. We store a rounded home area, never your exact address.',
    Glyph: MapPin,
    permission: 'location',
  },
  {
    key: 'score',
    eyebrow: 'Step two',
    title: 'Every shot gets scored',
    body: 'Composition, how rare the pose is, and how unusual the cat is. Your album stays private until you decide to share a photo.',
    Glyph: Trophy,
  },
];

type Props = NativeStackScreenProps<AuthStackParamList, 'Onboarding'>;

export function OnboardingScreen({ navigation }: Props) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const width = Dimensions.get('window').width;

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

  const slide = SLIDES[index];

  const grant = useCallback(async () => {
    if (slide.permission === 'camera') await camera.request();
    if (slide.permission === 'location') await requestLocation();
    advance();
  }, [advance, camera, slide.permission]);

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
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={styles.glyphWell}>
              <item.Glyph size={34} color={marmalade[600]} weight={icon.weightDefault} />
            </View>

            <Eyebrow label={item.eyebrow} style={styles.eyebrow} />

            <Text style={[text.h1, styles.title]} textBreakStrategy="balanced">
              {item.title}
            </Text>
            <Text style={[text.body, styles.body]}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.footer}>
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
          trailingIcon={!slide.permission}
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
    paddingTop: spacing.xxxl,
    // Left-aligned rather than centred — a centred onboarding stack is the generic default.
    alignItems: 'flex-start',
  },
  glyphWell: {
    width: 72,
    height: 72,
    borderRadius: radii.xxl,
    backgroundColor: marmalade[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  eyebrow: {
    marginBottom: spacing.sm,
  },
  title: {
    color: paper.text,
    maxWidth: measure,
  },
  body: {
    color: paper.textMuted,
    marginTop: spacing.sm,
    maxWidth: measure,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
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
