import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { FloatingTabBar } from './FloatingTabBar';
import type {
  AlbumStackParamList,
  AuthStackParamList,
  ChallengesStackParamList,
  HomeStackParamList,
  MainTabParamList,
  MapStackParamList,
  ProfileStackParamList,
  RootStackParamList,
} from './types';

import { SplashScreen } from '../screens/auth/SplashScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { SignInSignUpScreen } from '../screens/auth/SignInSignUpScreen';
import { UsernameSetupScreen } from '../screens/auth/UsernameSetupScreen';

import { ViralFeedScreen } from '../screens/home/ViralFeedScreen';

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
      <Auth.Screen name="Onboarding" component={OnboardingScreen} />
      <Auth.Screen name="SignInSignUp" component={SignInSignUpScreen} />
    </Auth.Navigator>
  );
}

const HomeNav = createNativeStackNavigator<HomeStackParamList>();

function HomeStack() {
  return (
    <HomeNav.Navigator screenOptions={commonStackOptions}>
      <HomeNav.Screen name="ViralFeed" component={ViralFeedScreen} />
      <HomeNav.Screen name="PhotoDetail" component={PhotoDetailScreen} />
      <HomeNav.Screen name="CatProfile" component={CatProfileScreen} />
      <HomeNav.Screen name="PublicProfile" component={PublicProfileScreen} />
    </HomeNav.Navigator>
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
      initialRouteName="HomeTab"
    >
      <Tabs.Screen name="HomeTab" component={HomeStack} />
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
 * How long the splash stays up at minimum. Session restore usually finishes in well under
 * this, and swapping it out after 40ms reads as a flicker rather than an opening.
 */
const SPLASH_MIN_MS = 620;

/**
 * Swaps stacks on auth status.
 *
 * Conditional rendering rather than imperative navigation: when the session ends —
 * including a failed token refresh deep in a request — the tree changes and React
 * Navigation resets cleanly. Screens never have to route on sign-out themselves.
 *
 * The splash lives here rather than at the top of the auth stack. Inside that stack it
 * would be the landing screen for every signed-out launch with nothing to move off it,
 * and it belongs to session restore anyway — a state both branches pass through.
 */
export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  // Empty until the player picks one, so it doubles as "this account is not set up yet".
  // Requires a loaded profile: launching offline keeps the session but leaves `user` null,
  // and an established account must not be dropped into setup just because /me failed.
  const needsSetup = useAuthStore((s) => s.user !== null && !s.user.avatarUrl);
  const [minimumElapsed, setMinimumElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {status === 'loading' || !minimumElapsed ? (
        <Root.Screen name="Splash" component={SplashScreen} />
      ) : status !== 'authenticated' ? (
        <Root.Screen name="AuthStack" component={AuthStack} />
      ) : needsSetup ? (
        // Signing up authenticates immediately, which tears down the auth stack. Setup has
        // to be its own branch here or the avatar step gets skipped entirely.
        <Root.Screen name="UsernameSetup" component={UsernameSetupScreen} />
      ) : (
        <>
          <Root.Screen name="MainTabs" component={MainTabs} />
          <Root.Screen name="NotFound" component={NotFoundScreen} />
        </>
      )}
    </Root.Navigator>
  );
}
