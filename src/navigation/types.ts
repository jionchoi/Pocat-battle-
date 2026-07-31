import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Route params for the whole app (README section 8).
 *
 * Typing these centrally is what makes `navigation.navigate` catch a wrong param at
 * compile time instead of at runtime on a device.
 */

export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  SignInSignUp: undefined;
  UsernameSetup: undefined;
};

export type MapStackParamList = {
  Map: undefined;
  Capture: undefined;
  ScoreResult: undefined;
};

export type AlbumStackParamList = {
  PhotoAlbumGrid: undefined;
  CatDex: undefined;
  CatProfile: { catId: string };
  PhotoDetail: { photoId: string };
};

export type ChallengesStackParamList = {
  ChallengesHub: undefined;
  ChallengeSubmission: { challengeId: string; title: string };
  ChallengeEntries: { challengeId: string; title: string };
  Leaderboard: undefined;
  CommunityFeed: undefined;
  FriendsList: undefined;
  PublicProfile: { userId: string };
};

export type ProfileStackParamList = {
  Profile: undefined;
  PublicProfile: { userId: string };
  Shop: undefined;
  Settings: undefined;
  PrivacyData: undefined;
};

/**
 * Four tabs, not five (README section 8). Dropping the battle system removed a whole tab
 * rather than just its screens.
 */
export type MainTabParamList = {
  MapTab: NavigatorScreenParams<MapStackParamList>;
  AlbumTab: NavigatorScreenParams<AlbumStackParamList>;
  ChallengesTab: NavigatorScreenParams<ChallengesStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  AuthStack: NavigatorScreenParams<AuthStackParamList>;
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  NotFound: undefined;
};

/**
 * Makes untyped `useNavigation()` calls resolve against the root param list, so a screen
 * that does not receive props still gets checked.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
