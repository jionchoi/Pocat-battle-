import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import * as SplashScreenModule from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';

import { ToastHost } from './src/components/Toast';
import { linking } from './src/navigation/linking';
import { RootNavigator } from './src/navigation/RootNavigator';
import { bone } from './src/theme';
import { useAuthStore } from './src/store/authStore';

/**
 * App root.
 *
 * The splash screen is held until fonts are ready. A flash of system font on launch undoes
 * the entire type system, and it is very visible on a cold start.
 *
 * Satoshi is not on Google Fonts — download the four weights from fontshare.com/fonts/satoshi
 * into src/assets/fonts/ (see typography.ts `requiredFontFiles`). Until they exist, the
 * Satoshi entries below must stay commented out or Metro fails to resolve them.
 */

void SplashScreenModule.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const [ready, setReady] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    // Uncomment once the Fontshare files are in src/assets/fonts/:
    // 'Satoshi-Medium': require('./src/assets/fonts/Satoshi-Medium.otf'),
    // 'Satoshi-SemiBold': require('./src/assets/fonts/Satoshi-SemiBold.otf'),
    // 'Satoshi-Bold': require('./src/assets/fonts/Satoshi-Bold.otf'),
    // 'Satoshi-Black': require('./src/assets/fonts/Satoshi-Black.otf'),
  });

  useEffect(() => {
    // A missing font file must not block the app forever — log it and carry on with the
    // platform fallback rather than showing an indefinite splash.
    if (fontsLoaded || fontError) setReady(true);
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    if (ready) void hydrate();
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
    backgroundColor: bone.bg,
  },
});
