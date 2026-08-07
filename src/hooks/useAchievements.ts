import { useEffect, useMemo } from 'react';

import {
  achievementStats,
  evaluateAchievements,
  type Achievement,
} from '../constants/achievements';
import { useAlbumStore } from '../store/albumStore';
import { useAuthStore } from '../store/authStore';

/**
 * The achievement tree, evaluated against this device's album.
 *
 * Owns the fetch as well as the arithmetic, because both surfaces that read it — the
 * summary box on the Challenges hub and the tree screen behind it — can be the first
 * thing a player opens after a cold start.
 *
 * The effect is keyed on the signed-in id rather than on mount: `albumStore.load` reads
 * the current user out of the auth store and returns early when there is none, so on a
 * cold start a mount-only effect fires once into a null session and never runs again.
 * Both loaders are cheap when the data is already there.
 */
export function useAchievements(): Achievement[] {
  const user = useAuthStore((s) => s.user);

  const photos = useAlbumStore((s) => s.photos);
  const cats = useAlbumStore((s) => s.cats);
  const load = useAlbumStore((s) => s.load);
  const loadCatDex = useAlbumStore((s) => s.loadCatDex);

  const userId = user?.id ?? null;
  const reactions = user?.votesReceived ?? 0;

  useEffect(() => {
    if (!userId) return;
    void load();
    void loadCatDex();
  }, [load, loadCatDex, userId]);

  return useMemo(
    () => evaluateAchievements(achievementStats({ photos, cats, reactions })),
    [cats, photos, reactions]
  );
}
