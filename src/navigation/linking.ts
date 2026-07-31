import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/**
 * Deep linking.
 *
 * Every linkable route resolves to a screen that can handle a missing target — the photo
 * detail, cat profile and public profile screens all render their own not-found state
 * rather than crashing on a stale id, and anything unmatched falls through to NotFound.
 *
 * `Capture` and `ScoreResult` are deliberately not linkable: a link cannot supply the
 * live camera state or the scored result those screens exist to display.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'catsnap://', 'https://catsnap.app'],

  config: {
    screens: {
      AuthStack: {
        screens: {
          SignInSignUp: 'signin',
          Onboarding: 'welcome',
        },
      },

      MainTabs: {
        screens: {
          MapTab: {
            screens: {
              Map: 'map',
            },
          },

          AlbumTab: {
            screens: {
              PhotoAlbumGrid: 'album',
              CatDex: 'catdex',
              CatProfile: 'cat/:catId',
              PhotoDetail: 'photo/:photoId',
            },
          },

          ChallengesTab: {
            screens: {
              ChallengesHub: 'challenges',
              ChallengeEntries: 'challenge/:challengeId',
              Leaderboard: 'leaderboard',
              CommunityFeed: 'feed',
              FriendsList: 'friends',
              PublicProfile: 'photographer/:userId',
            },
          },

          ProfileTab: {
            screens: {
              Profile: 'me',
              Shop: 'shop',
              Settings: 'settings',
              PrivacyData: 'privacy',
            },
          },
        },
      },

      // Unmatched paths land here rather than on a blank screen.
      NotFound: '*',
    },
  },
};

/**
 * Route names a push notification may target.
 *
 * The push integration sends a `screen` field; this keeps the two ends from drifting
 * apart silently. Every value here must exist in `config.screens` above, or tapping the
 * notification opens the app to nowhere in particular.
 */
export const PUSH_TARGETS = {
  ChallengesHub: 'challenges',
  PhotoDetail: 'photo',
  FriendsList: 'friends',
  Map: 'map',
} as const;
