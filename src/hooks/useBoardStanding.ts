import { useEffect, useState } from 'react';

import { socialApi } from '../api/endpoints';
import type { LeaderboardEntry } from '../models';

/**
 * Where a player stands on the best-score board, if they are on the visible part of it.
 *
 * ## Only the top ten
 *
 * The board is a trophy shelf, not a ranking of everybody: rank 4,318 is a fact nobody
 * wants displayed on their own profile, and a profile that always carries a number turns
 * the standing into a permanent judgement rather than an achievement. So this resolves to
 * `null` for anyone outside the top ten, and the profile simply shows nothing.
 *
 * ## Which board
 *
 * The same one the challenges hub previews — neighbourhood, ranked by best single photo,
 * over a rolling 30 days. And only *shared* photos count: publishing a shot is what enters
 * it into the competition, so a private photo can score 400 and never appear here.
 *
 * Pass a `userId` for somebody else's profile; omit it for your own, where the server has
 * already marked the row with `isSelf`.
 */
const TOP_N = 10;

export function useBoardStanding(userId?: string): LeaderboardEntry | null {
  const [entry, setEntry] = useState<LeaderboardEntry | null>(null);

  useEffect(() => {
    let live = true;

    socialApi
      .leaderboard({ scope: 'neighborhood', metric: 'topPhoto', limit: TOP_N })
      .then((result) => {
        if (!live) return;

        const found = result.entries
          .slice(0, TOP_N)
          .find((row) => (userId ? row.userId === userId : row.isSelf));

        setEntry(found ?? null);
      })
      // A profile is perfectly readable without a trophy on it, so a failure here is
      // silent rather than an error banner over somebody's photographs.
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [userId]);

  return entry;
}
