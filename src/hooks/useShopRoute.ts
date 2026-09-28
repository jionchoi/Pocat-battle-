import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';

import { ApiRequestError } from '../api/client';

/**
 * The way to the shop, from anywhere.
 *
 * Four places need it — the paw button when both buckets are empty, a reveal refused for want
 * of paws on Photo Detail and on the score result, and a locked filter on the camera rail —
 * and each of them used to be, or was about to be, its own inline `navigate` call. Trap 18 is
 * the reason it is one function instead: the same few lines written out four times is a
 * defence that will be missing from one of them.
 *
 * Untyped `useNavigation()` on purpose. The callers sit in three different stacks with three
 * different param lists, and the root list is the only one they share — so the route is spelled
 * from `MainTabs` down, which typechecks from every one of them.
 *
 * ## `initial: false` is not optional
 *
 * Trap 11. Without it the profile stack becomes `[Shop]` rather than `[Profile, Shop]`: back
 * does nothing, and pressing the Profile tab reopens the shop because a one-route stack has
 * nothing to pop to. It cost three separate bug reports the first time, on the map tab.
 */
export function useShopRoute(): () => void {
  const navigation = useNavigation();

  return useCallback(() => {
    navigation.navigate('MainTabs', {
      screen: 'ProfileTab',
      params: { screen: 'Shop', initial: false },
    });
  }, [navigation]);
}

/**
 * Whether a failed request was refused for want of paws.
 *
 * The server answers every "you cannot afford this" with the same code — a gift, a reveal and
 * an unlock alike — so this is the one check the client needs to route to the shop rather than
 * to a generic error. A type guard, so the caller can read `err.message` without a cast: the
 * server's message is written for the player and is always the better sentence to show.
 */
export function isNoPaws(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError && err.code === 'no_paws';
}
