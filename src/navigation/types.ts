import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Route params for the whole app (README section 8).
 *
 * Typing these centrally is what makes `navigation.navigate` catch a wrong param at
 * compile time instead of at runtime on a device.
 */

export type AuthStackParamList = {
  Onboarding: undefined;
  SignInSignUp: undefined;
};

/**
 * Home — the viral feed and the two places a photo on it leads.
 *
 * `PhotoDetail` is deliberately duplicated here rather than reached across into the album
 * stack: opening a stranger's photo from the feed and then finding yourself inside your
 * own album's back stack is the kind of navigation bug that is very hard to explain and
 * very easy to hit.
 */
export type HomeStackParamList = {
  ViralFeed: undefined;
  PhotoDetail: { photoId: string };
  /**
   * Duplicated from the album stack for the same reason `PhotoDetail` is: Photo Detail
   * offers a way through to the cat's Dex entry, and that has to land somewhere inside
   * the stack the reader is already in rather than teleporting them into their own album.
   */
  CatProfile: { catId: string };
  PublicProfile: { userId: string };
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
 * Five tabs, home first.
 *
 * The map used to be the landing surface, which framed the product as a location game
 * that happened to store photos. It is a cat photo network: what other people posted is
 * the reason to open the app, and the map is where you go to add to it.
 */
export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  MapTab: NavigatorScreenParams<MapStackParamList>;
  AlbumTab: NavigatorScreenParams<AlbumStackParamList>;
  ChallengesTab: NavigatorScreenParams<ChallengesStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  /** Held at the root, not inside the auth stack — it covers session restore for both. */
  Splash: undefined;
  AuthStack: NavigatorScreenParams<AuthStackParamList>;
  /**
   * Signed in but not set up yet. Sits at the root because the account already exists by
   * this point — the auth stack has been torn down, so it cannot live there.
   */
  UsernameSetup: undefined;
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
