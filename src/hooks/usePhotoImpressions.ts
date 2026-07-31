import { useCallback, useEffect, useRef } from 'react';

import { photoApi } from '../api/endpoints';
import { FEED_CONFIG } from '../constants/game';

/**
 * Reports which photos the player actually looked at.
 *
 * This is the denominator of the community engagement ratio, so it has to mean "was
 * genuinely on screen" rather than "was in a page the server sent". A photo the player
 * scrolled straight past was never seen, and counting it would quietly depress someone
 * else's standing.
 *
 * Three things make this cheap and honest:
 *
 *  - **Batched.** One request per photo would be a request every couple of hundred
 *    milliseconds while scrolling. Ids accumulate and flush on a timer.
 *  - **Deduped locally.** A photo already reported this session is never sent again, so
 *    scrolling back up costs nothing. The server dedupes too, by unique constraint —
 *    this half is a bandwidth optimisation, not the correctness boundary.
 *  - **Fire and forget.** A failed report is not worth telling the player about; the
 *    ids are simply dropped rather than retried forever.
 */
export function usePhotoImpressions() {
  /** Ids seen this session — the local dedupe. */
  const reported = useRef<Set<string>>(new Set());
  /** Ids waiting for the next flush. */
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const flush = useCallback(() => {
    timer.current = null;

    const ids = [...pending.current];
    pending.current.clear();
    if (ids.length === 0) return;

    // Marked as reported before the request resolves. A retry loop on a metric this
    // soft is not worth the complexity, and double-reporting is harmless server-side.
    for (const id of ids) reported.current.add(id);

    photoApi.impressions(ids).catch(() => undefined);
  }, []);

  const record = useCallback(
    (photoIds: string[]) => {
      let added = false;

      for (const id of photoIds) {
        if (reported.current.has(id) || pending.current.has(id)) continue;
        pending.current.add(id);
        added = true;
      }

      if (!added || timer.current !== null) return;

      timer.current = setTimeout(() => {
        if (mounted.current) flush();
      }, FEED_CONFIG.impressionFlushMs);
    },
    [flush]
  );

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // Send whatever was still queued on the way out — a player who scrolls and then
      // leaves still saw those photos.
      const ids = [...pending.current];
      pending.current.clear();
      if (ids.length > 0) photoApi.impressions(ids).catch(() => undefined);
    };
  }, []);

  return { record };
}
