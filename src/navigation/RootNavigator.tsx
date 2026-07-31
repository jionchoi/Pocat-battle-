import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { FloatingTabBar } from './FloatingTabBar';
import type {
  AlbumStackParamList,
  AuthStackParamList,
  ChallengesStackParamList,
  MainTabParamList,
  MapStackParamList,
  ProfileStackParamList,
  RootStackParamList,
} from './types';

import { SplashScreen } from '../screens/auth/SplashScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { SignInSignUpScreen } from '../screens/auth/SignInSignUpScreen';
import { UsernameSetupScreen } from '../screens/auth/UsernameSetupScreen';

import { MapScreen } from '../screens/map/MapScreen';
import { CaptureScreen } from '../screens/map/CaptureScreen';
import { ScoreResultScreen } from '../screens/map/ScoreResultScreen';

import { PhotoAlbumGridScreen } from '../screens/album/PhotoAlbumGridScreen';
import { CatDexScreen } from '../screens/album/CatDexScreen';
import { CatProfileScreen } from '../screens/album/CatProfileScreen';
import { PhotoDetailScreen } from '../screens/album/PhotoDetailScreen';

import { ChallengesHubScreen } from '../screens/challenges/ChallengesHubScreen';
import { ChallengeSubmissionScreen } from '../screens/challenges/ChallengeSubmissionScreen';
import { ChallengeEntriesScreen } from '../screens/challenges/ChallengeEntriesScreen';
import { LeaderboardScreen } from '../screens/social/LeaderboardScreen';
import { CommunityFeedScreen } from '../screens/social/CommunityFeedScreen';
import { FriendsListScreen } from '../screens/social/FriendsListScreen';
import { PublicProfileScreen } from '../screens/social/PublicProfileScreen';

import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { ShopScreen } from '../screens/profile/ShopScreen';
import { SettingsScreen } from '../screens/profile/SettingsScreen';
import { PrivacyDataScreen } from '../screens/profile/PrivacyDataScreen';

import { NotFoundScreen } from '../screens/NotFoundScreen';
import { useAuthStore } from '../store/authStore';

/**
 * Navigation tree (README section 8).
 *
 * Headers are off throughout: every screen renders its own `ScreenHeader`, which keeps
 * the type scale and the back affordance consistent instead of half native chrome and
 * half ours.
 */

const commonStackOptions = {
  headerShown: false,
  // Slide feels wrong for a photo app; a soft fade matches the motion spec's easing.
  animation: 'fade_from_bottom' as const,
} as const;

/* ---------------------------------- stacks --------------------------------- */

const Auth = createNativeStackNavigator<AuthStackParamList>();

function AuthStack() {
  return (
    <Auth.Navigator screenOptions={commonStackOptions}>
      <Auth.Screen name="Splash" component={SplashScreen} />
      <Auth.Screen name="Onboarding" component={OnboardingScreen} />
      <Auth.Screen name="SignInSignUp" component={SignInSignUpScreen} />
      <Auth.Screen name="UsernameSetup" component={UsernameSetupScreen} />
    </Auth.Navigator>
  );
}

const MapNav = createNativeStackNavigator<MapStackParamList>();

function MapStack() {
  return (
    <MapNav.Navigator screenOptions={commonStackOptions}>
      <MapNav.Screen name="Map" component={MapScreen} />
      {/* Camera and reveal are modal presentations over the map. */}
      <MapNav.Screen
        name="Capture"
        component={CaptureScreen}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
      {/* The reveal disables the back gesture — swiping out mid-reveal would drop the
          player back on a live camera with no idea what they scored. */}
      <MapNav.Screen
        name="ScoreResult"
        component={ScoreResultScreen}
        options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
      />
    </MapNav.Navigator>
  );
}

const AlbumNav = createNativeStackNavigator<AlbumStackParamList>();

function AlbumStack() {
  return (
    <AlbumNav.Navigator screenOptions={commonStackOptions}>
      <AlbumNav.Screen name="PhotoAlbumGrid" component={PhotoAlbumGridScreen} />
      <AlbumNav.Screen name="CatDex" component={CatDexScreen} />
      <AlbumNav.Screen name="CatProfile" component={CatProfileScreen} />
      <AlbumNav.Screen name="PhotoDetail" component={PhotoDetailScreen} />
    </AlbumNav.Navigator>
  );
}

const ChallengesNav = createNativeStackNavigator<ChallengesStackParamList>();

function ChallengesStack() {
  return (
    <ChallengesNav.Navigator screenOptions={commonStackOptions}>
      <ChallengesNav.Screen name="ChallengesHub" component={ChallengesHubScreen} />
      <ChallengesNav.Screen
        name="ChallengeSubmission"
        component={ChallengeSubmissionScreen}
      />
      <ChallengesNav.Screen name="ChallengeEntries" component={ChallengeEntriesScreen} />
      <ChallengesNav.Screen name="Leaderboard" component={LeaderboardScreen} />
      <ChallengesNav.Screen name="CommunityFeed" component={CommunityFeedScreen} />
      <ChallengesNav.Screen name="FriendsList" component={FriendsListScreen} />
      <ChallengesNav.Screen name="PublicProfile" component={PublicProfileScreen} />
    </ChallengesNav.Navigator>
  );
}

const ProfileNav = createNativeStackNavigator<ProfileStackParamList>();

function ProfileStack() {
  return (
    <ProfileNav.Navigator screenOptions={commonStackOptions}>
      <ProfileNav.Screen name="Profile" component={ProfileScreen} />
      <ProfileNav.Screen name="PublicProfile" component={PublicProfileScreen} />
      <ProfileNav.Screen name="Shop" component={ShopScreen} />
      <ProfileNav.Screen name="Settings" component={SettingsScreen} />
      <ProfileNav.Screen name="PrivacyData" component={PrivacyDataScreen} />
    </ProfileNav.Navigator>
  );
}

/* ----------------------------------- tabs ---------------------------------- */

const Tabs = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tabs.Navigator
      // The floating glass pill from DESIGN.md section 5, not an edge-to-edge bar.
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
      initialRouteName="MapTab"
    >
      <Tabs.Screen name="MapTab" component={MapStack} />
      <Tabs.Screen name="AlbumTab" component={AlbumStack} />
      <Tabs.Screen name="ChallengesTab" component={ChallengesStack} />
      <Tabs.Screen name="ProfileTab" component={ProfileStack} />
    </Tabs.Navigator>
  );
}

/* ----------------------------------- root ---------------------------------- */

const Root = createNativeStackNavigator<RootStackParamList>();

/**
 * Swaps stacks on auth status.
 *
 * Conditional rendering rather than imperative navigation: when the session ends —
 * including a failed token refresh deep in a request — the tree changes and React
 * Navigation resets cleanly. Screens never have to route on sign-out themselves.
 */
export function RootNavigator() {
  const status = useAuthStore((s) => s.status);

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {status === 'authenticated' ? (
        <>
          <Root.Screen name="MainTabs" component={MainTabs} />
          <Root.Screen name="NotFound" component={NotFoundScreen} />
        </>
      ) : (
        <Root.Screen name="AuthStack" component={AuthStack} />
      )}
    </Root.Navigator>
  );
}
