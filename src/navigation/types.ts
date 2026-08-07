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
 * The album screens, which every tab can push.
 *
 * The album used to be a tab of its own — hidden from the bar, but a tab, which is why it
 * had no way back: a tab root has nothing underneath it to return to. Opening your album
 * from the map and pressing back left you on the album with nowhere to go.
 *
 * So it is not a place, it is a set of screens four different places can push. Wherever
 * you opened it from is underneath it, and back means what it says.
 */
export type AlbumRoutes = {
  PhotoAlbumGrid: undefined;
  CatDex: undefined;
  CatProfile: { catId: string };
  PhotoDetail: { photoId: string };
};

/** Kept as the name the album screens type themselves against. */
export type AlbumStackParamList = AlbumRoutes;

export type HomeStackParamList = AlbumRoutes & {
  ViralFeed: undefined;
  PublicProfile: { userId: string };
};

/**
 * The social screens, which hang off two tabs.
 *
 * The community feed is reachable from the map — the map is the screen where the other
 * players are — and from the challenges tab, which is where the standings live. It has to
 * be a route *in each stack* rather than one route jumped to across tabs: a player who
 * opens the feed from the map and presses back expects the map, and a cross-tab jump hands
 * them the challenges hub instead, which is a screen they never asked for.
 *
 * Same reasoning as the duplicated `PhotoDetail` above, and the same cost: the two copies
 * are separate history entries, which is exactly what makes back mean "where I came from".
 */
export type SocialRoutes = {
  CommunityFeed: undefined;
  FriendsList: undefined;
  PublicProfile: { userId: string };
};

export type MapStackParamList = SocialRoutes &
  AlbumRoutes & {
    Map: undefined;
    Capture: undefined;
    ScoreResult: undefined;
  };

export type ChallengesStackParamList = SocialRoutes &
  AlbumRoutes & {
    ChallengesHub: undefined;
    ChallengeSubmission: { challengeId: string; title: string };
    ChallengeEntries: { challengeId: string; title: string };
    Leaderboard: undefined;
    Achievements: undefined;
  };

export type ProfileStackParamList = AlbumRoutes & {
  Profile: undefined;
  PublicProfile: { userId: string };
  Shop: undefined;
  Settings: undefined;
  PrivacyData: undefined;
};

/**
 * Four tabs, home first.
 *
 * The map used to be the landing surface, which framed the product as a location game
 * that happened to store photos. It is a cat photo network: what other people posted is
 * the reason to open the app, and the map is where you go to add to it.
 *
 * There is no album tab. Four things a player can name — trending, the map, the week's
 * challenges, and themselves — and everything else is a screen one of those four pushes.
 */
export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  MapTab: NavigatorScreenParams<MapStackParamList>;
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
