import React from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { PawLoader } from './PawLoader';
import { marmalade, spacing } from '../theme';

/**
 * Pull-to-refresh, wearing the paw instead of the platform spinner.
 *
 * `RefreshControl` renders a native view whose contents cannot be replaced — iOS will not
 * let anything else live inside it. So the native indicator is made invisible and the
 * space it holds open is filled with our own paws, absolutely positioned over the top of
 * the list. The gesture, the threshold and the release animation stay native, which is the
 * half worth keeping; only the artwork changes.
 *
 * `onRefresh` still comes from the caller — this owns nothing but the appearance.
 */

export interface PawRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  /**
   * Where the paws sit, measured from the top of the scroll container. Defaults to the
   * offset the native control opens at; screens with their own header above the list pass
   * their own.
   */
  top?: number;
}

/**
 * The control itself. Every colour prop is transparent — on iOS that hides the spiral, on
 * Android the ring and the disc it sits on.
 */
export function pawRefreshControl({ refreshing, onRefresh }: PawRefreshProps) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor="transparent"
      colors={['transparent']}
      progressBackgroundColor="transparent"
    />
  );
}

/**
 * The paws that replace it.
 *
 * A sibling of the list rather than a child: as a `ListHeaderComponent` it would push the
 * first row down on top of the space the native control already opened, and the list would
 * lurch twice on every pull.
 */
export const PawRefreshIndicator = React.memo(function PawRefreshIndicator({
  refreshing,
  top = 0,
}: {
  refreshing: boolean;
  top?: number;
}) {
  if (!refreshing) return null;

  return (
    <View pointerEvents="none" style={[styles.host, { top }]}>
      <PawLoader size={18} color={marmalade[600]} count={3} label="Refreshing" />
    </View>
  );
});

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: spacing.xxs,
    // Above the list's own rows, which paint in document order underneath it.
    zIndex: 3,
  },
});
