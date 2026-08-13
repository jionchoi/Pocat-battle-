/**
 * Album rules.
 *
 * Small, but it belongs in `game/` rather than inline in a service for the same reason the
 * rubric does: these are numbers the product chose, not implementation details, and every
 * one of them is also written down in the client's `constants/game.ts`. Mirroring them here
 * is deliberate — the client's copy draws a meter, this copy decides an answer.
 */

/**
 * How many photos a player may pin to their public showcase.
 *
 * `ALBUM_CONFIG.showcaseLimit` in the client, and `SHOWCASE_LIMIT` in ProfileParts.tsx.
 * Both of those slice a list to six for display; this one refuses the seventh pin, which is
 * the difference between a grid that hides the overflow and a limit that exists.
 */
export const SHOWCASE_LIMIT = 6;

/**
 * Album page size — the default, and the ceiling on what a caller may ask for.
 *
 * Twenty, which divides the free tier's 200-photo album (`ALBUM_CONFIG.freePhotoLimit`) into
 * exactly ten pages. A free player's entire history is therefore a scroll with a known end,
 * and the tenth page is the one the upsell has to live near.
 *
 * Matches `ALBUM_CONFIG.pageSize` in the client, which sends it as `limit` on every album
 * request — so this constant is the fallback for a caller that omits it, not the value the
 * app actually pages by. The two are kept equal so a page is a page whoever asked.
 *
 * The maximum exists because `limit` arrives in a query string: without it, one request for
 * a hundred thousand rows is a valid request. It is not the free tier's cap — a Pro album is
 * unbounded and still pages twenty at a time.
 */
export const ALBUM_PAGE_SIZE = 20;
export const ALBUM_PAGE_SIZE_MAX = 100;

/**
 * How many photographs an album holds.
 *
 * `ALBUM_CONFIG.freePhotoLimit` in the client, where it has only ever drawn a meter. This
 * copy is the one that decides.
 *
 * ## The cap does not stop the shutter, and it does not withhold the score
 *
 * A capture at the cap is stored and judged like any other, and the player is then made to
 * choose: delete something to keep it, or discard it. Both branches are a real answer and
 * neither is free — the reveal is spent either way, which is why `reveals` had to become a
 * table that outlives a photo.
 *
 * The alternative was refusing the capture outright, and it is worse in the moment that
 * matters. A cat does not wait while a player prunes an album, and a game whose answer to a
 * once-in-a-year shot is a full-storage dialog before the shutter has taught the player to
 * stop pointing the camera at things.
 *
 * ## One over, never two
 *
 * The overflow is exactly one photograph. `assertAlbumHasRoom` refuses a capture while the
 * album is *already* over, so the choice cannot be deferred indefinitely by taking more
 * photos — the 201st is stored, and there is no 202nd until the player resolves it.
 */
export const PHOTO_LIMITS = {
  free: 200,
  /** Null means unbounded. */
  pro: null,
} as const;
