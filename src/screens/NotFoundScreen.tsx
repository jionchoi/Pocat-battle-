import React from 'react';
import { useNavigation } from '@react-navigation/native';

import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';

/**
 * The 404 equivalent.
 *
 * Deep links break: a sighting expires, a photo is deleted, an account is closed. Without this
 * the app lands on a blank screen with no way back, which is the mobile version of an
 * unhandled route.
 */
export function NotFoundScreen() {
  const navigation = useNavigation();

  return (
    <Screen>
      <EmptyState
        title="This cat has moved on"
        body="That link points at something we could not find. It may have expired, or been released on another device."
        actionLabel="Back to the map"
        onAction={() => {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate('MainTabs' as never);
        }}
      />
    </Screen>
  );
}
