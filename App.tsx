import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import * as SplashScreenModule from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  SpaceMono_400Regular,
  SpaceMono_700Bold,
} from '@expo-google-fonts/space-mono';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import {
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { ToastHost } from './src/components/Toast';
import { linking } from './src/navigation/linking';
import { RootNavigator } from './src/navigation/RootNavigator';
import { paper } from './src/theme';
import { useAuthStore } from './src/store/authStore';
import { useReactionStore } from './src/store/reactionStore';

/**
 * App root.
 *
 * The splash screen is held until fonts are ready. A flash of system font on launch undoes
 * the entire type system, and it is very visible on a cold start.
 *
 * All three families ship as npm packages, so there is no manual download step and no
 * commented-out `require()` waiting to be uncommented. That arrangement is how the app
 * previously ran its entire life in system San Francisco without anyone noticing.
 */

void SplashScreenModule.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const [ready, setReady] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    // Display voice — headings and every numeral.
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    // UI voice.
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    // Mode labels and photo annotations.
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  useEffect(() => {
    // A missing font file must not block the app forever — log it and carry on with the
    // platform fallback rather than showing an indefinite splash.
    if (fontsLoaded || fontError) setReady(true);
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    if (!ready) return;
    void hydrate();
    // The feed is served from a shared cache with no viewer in it, so this device's own
    // reactions come from disk. Loaded alongside the session rather than by the feed
    // screen, so the reaction buttons are never briefly wrong on first paint.
    void useReactionStore.getState().hydrate();
  }, [hydrate, ready]);

  const onNavigationReady = useCallback(() => {
    void SplashScreenModule.hideAsync().catch(() => undefined);
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer linking={linking} onReady={onNavigationReady}>
          <View style={styles.root}>
            <RootNavigator />
            {/* Above the navigator so a toast can appear over a modal. */}
            <ToastHost />
          </View>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: paper.bg,
  },
});
