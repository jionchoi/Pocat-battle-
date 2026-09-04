import type {
  Cat,
  CatCandidate,
  CatProfile,
  Challenge,
  ChallengeGoal,
  ChallengeTrophy,
  ChallengeLeader,
  CatSighting,
  GeoPoint,
  Identification,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardScope,
  Photo,
  PhotoDetail,
  PhotoWithAuthor,
  PublicProfile,
  Rarity,
  Reaction,
  AlbumUsage,
  Quotas,
  ScoredCapture,
  ShopItem,
  User,
} from '../models';
import { api } from './client';

/**
 * Typed wrappers for every endpoint in README section 11.
 *
 * Response shapes are declared here once so no screen has to guess what comes back, and
 * a backend change surfaces as a type error rather than an undefined at runtime.
 */

/* ---------------------------------- auth ---------------------------------- */

export interface NotificationPreferences {
  shareCapturesByDefault: boolean;
  pushChallengeResults: boolean;
  pushVotes: boolean;
  pushNearbyRareCats: boolean;
}

export const authApi = {
  /*
   * Signing up, signing in, refreshing and signing out are gone from here.
   *
   * Supabase issues and rotates the session, and the app talks to it directly through
   * lib/supabase.ts — so an endpoint of ours in front of that would be a second
   * implementation of the one thing we deliberately stopped writing ourselves.
   *
   * Reading and updating a profile are gone too, for a different reason: row level
   * security already answers "may you see this row" and "may you edit this row", so those
   * go straight to Postgres from lib/profile.ts. What is left here is the work that needs
   * a key the app must never hold, or state the database does not own.
   */

  /**
   * Removing the account itself.
   *
   * Deleting from `auth.users` needs the admin API and therefore the service-role key,
   * which cannot ship in a bundle. The cascade on profiles and player_stats does the rest.
   */
  deleteAccount: () => api.delete<void>('/auth/account'),

  setPushToken: (token: string) => api.put<void>('/auth/push-token', { token }),

  setHomeLocation: (body: GeoPoint) => api.put<void>('/auth/home-location', body),

  preferences: () =>
    api.get<{ preferences: NotificationPreferences }>('/auth/preferences'),

  setPreferences: (body: Partial<NotificationPreferences>) =>
    api.patch<{ preferences: NotificationPreferences }>('/auth/preferences', body),
};

/* --------------------------------- photos --------------------------------- */

export const photoApi = {
  /**
   * Records a capture.
   *
   * The bytes are already in storage — the phone put them there itself, under a policy
   * that only lets it write into its own folder. This call carries the path, not the
   * image; the old base64 body inflated every upload by a third and pushed full-size
   * photos through the API process on their way to a bucket it was standing next to.
   */
  capture: (body: {
    storagePath: string;
    location: GeoPoint;
    capturedAt?: string;
    /**
     * What the on-device detector saw when the shutter fired.
     *
     * `false` tells the server not to spend a scoring call on this one. Send it honestly:
     * it is the app declining to buy an answer it can already guess, not a claim about the
     * photograph that earns anything.
     */
    detected?: boolean;
  }) => api.post<ScoredCapture>('/photos', body, { timeoutMs: 60_000 }),

  /**
   * Spends an allowance on a photo that was stored without a score.
   *
   * Answers with the same shape a capture does, failures included: a reveal that could not
   * reach the scorer is a 200 carrying `scoreError`, not a rejected request. Nothing was
   * charged, so it is a retry rather than a loss, and the caller should say so.
   */
  reveal: (photoId: string) =>
    api.post<ScoredCapture>(`/photos/${photoId}/reveal`, {}, { timeoutMs: 60_000 }),

  /** What is left in the rolling window, and how full the album is. */
  allowance: () => api.get<Quotas>('/photos/allowance'),

  /**
   * One photograph. The album serialization for its owner, the feed card for anybody else
   * — so the reply carries an `author` exactly when the caller is not the owner. See
   * `PhotoDetail`.
   */
  detail: (photoId: string) => api.get<{ photo: PhotoDetail }>(`/photos/${photoId}`),

  update: (
    photoId: string,
    body: {
      caption?: string;
      sharedToFeed?: boolean;
      showcased?: boolean;
      /** Takes the sighting pin down. The coordinates stay on the row either way. */
      sharedToMap?: boolean;
    }
  ) => api.patch<{ photo: Photo }>(`/photos/${photoId}`, body),

  remove: (photoId: string) => api.delete<void>(`/photos/${photoId}`),

  /**
   * Confirms which cat this photograph is of.
   *
   * The player's answer, not the matcher's. Nothing identifies a photo automatically —
   * a vision model asked "is this the same cat" is wrong in both directions and the second
   * kind of wrong quietly merges two animals into one Dex entry, which cannot be untangled
   * afterwards. So confirmation is the feature: the server shortlists and the player decides.
   *
   * `catId` attaches to a cat that already exists — theirs or anyone's. `newCat` says none of
   * the candidates was right and names a cat nobody has recorded yet; its traits and its
   * location are promoted off this photograph, which is why there is nothing else to send.
   *
   * Also how a mistake is corrected. Calling it again with a different cat moves the
   * photograph, and the response's `releasedCatId` names what it was moved off.
   *
   * Costs no model call. Matching reads traits already stored on the row, so re-identifying
   * as often as a player likes is pure Postgres.
   */
  identify: (
    photoId: string,
    body: { catId: string } | { newCat: { nickname: string } }
  ) => api.post<Identification>(`/photos/${photoId}/identify`, body),

  /**
   * The shortlist on its own, for identifying a photo from the album.
   *
   * Capture and reveal carry their candidates with them, because that is the moment the
   * sheet opens. This is the other moment: a photograph taken days ago that was never
   * attached to anybody, opened from the album with "Not this cat?" or with no cat at all.
   */
  candidates: (photoId: string) =>
    api.get<{ candidates: CatCandidate[] }>(`/photos/${photoId}/candidates`),

  vote: (photoId: string, reaction: Reaction) =>
    api.post<{
      reactions: Record<Reaction, number>;
      myReaction: Reaction | null;
      communityScore: number;
      viewCount: number;
    }>(`/photos/${photoId}/vote`, { reaction }),

  /**
   * Reports which photos actually became visible. This is the denominator of the
   * engagement ratio, so it is driven by real viewport events rather than by what the
   * feed happened to return.
   */
  impressions: (photoIds: string[]) =>
    api.post<{ recorded: number }>('/photos/impressions', { photoIds }),
};

/* ---------------------------------- paws ---------------------------------- */

/** Which pot a paw came out of. The server decides; the client is told. */
export type PawBucket = 'grant' | 'wallet';

export interface PawBalance {
  /** The weekly allowance. Expires — `resetsAt` is when it refills. */
  grant: { remaining: number; resetsAt: string };
  /** Received, won or bought. Never expires. */
  wallet: number;
}

export interface PawGiftResult {
  pawCount: number;
  bucket: PawBucket;
  balance: PawBalance;
}

/**
 * The paw economy — giving only.
 *
 * There is no `spend`. Reveals and cosmetics are priced in paws eventually and none of that
 * is built: it needs an entitlements table for cosmetics to live in, and prices nobody has
 * set. Giving works without any of it, which is why it shipped first.
 *
 * ## No body on the write, and no way back
 *
 * One paw per tap, and **the server picks the bucket**. Grant paws expire and wallet paws do
 * not, so spending the wallet first is worse for the player in every case — a request that
 * let the client choose would be offering a choice with one right answer, which is a trap
 * rather than a setting.
 *
 * **A gift is final.** There is no `undo` here and no `DELETE` on the server: a paw that has
 * been given stays given, because a gift that can evaporate is not a gift and the recipient
 * would be the one watching it go. See `server/src/game/paws.ts`.
 */
export const pawApi = {
  balance: () => api.get<PawBalance>('/paws/balance'),

  /** Gives one, for good. Refuses your own photo, and refuses an empty balance with `no_paws`. */
  give: (photoId: string) => api.post<PawGiftResult>(`/photos/${photoId}/paw`, {}),
};

/* ---------------------------------- album --------------------------------- */

export interface AlbumQuery {
  tier?: Rarity;
  search?: string;
  catId?: string;
  sort?: 'recent' | 'score';
  cursor?: string;
  limit?: number;
  /** Lets the shape satisfy the client's query-param record without a cast per call. */
  [key: string]: string | number | boolean | undefined;
}

export const albumApi = {
  list: (query: AlbumQuery = {}) =>
    api.get<{ photos: Photo[]; nextCursor: string | null }>('/album', { query }),
};

/* --------------------------------- cat dex -------------------------------- */

export const catdexApi = {
  list: () => api.get<{ cats: Cat[] }>('/catdex'),

  profile: (catId: string) => api.get<CatProfile>(`/catdex/${catId}`),

  update: (
    catId: string,
    /**
     * `bestPhotoId` pins that photo as the cat's Dex tile instead of the top scorer;
     * `bestPhotoPinned: false` releases the pin and hands the tile back to it.
     */
    body: {
      nickname?: string;
      bio?: string;
      bestPhotoId?: string;
      bestPhotoPinned?: false;
    }
  ) => api.patch<{ cat: Cat }>(`/catdex/${catId}`, body),
};

/* ----------------------------------- map ---------------------------------- */

export interface MapSighting extends CatSighting {
  isMine: boolean;
}

/** minLng,minLat,maxLng,maxLat — the order the server expects. */
export function bboxParam(box: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): string {
  return `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`;
}

export const mapApi = {
  sightings: (bbox: string, signal?: AbortSignal) =>
    api.get<{ sightings: MapSighting[] }>('/map/sightings', { query: { bbox }, signal }),

  report: (location: GeoPoint) =>
    api.post<{ id: string; verified: boolean }>('/map/sightings', { location }),
};

/* ------------------------------- challenges ------------------------------- */

/**
 * Everything past `active` and `past` is optional, and each surface on the hub drops out
 * on its own when its field is missing. That keeps an older server from rendering a
 * skeleton of empty slots.
 */
export interface ActiveChallenges {
  active: Challenge[];
  past: Challenge[];
  /** Standing goals — the meters under the hero. */
  goals?: ChallengeGoal[];
  /** Who is ahead in the headline challenge. */
  leader?: ChallengeLeader | null;
  /** The player's consecutive-capture streak, for the pill beside the title. */
  streakDays?: number | null;
}

export const challengeApi = {
  active: () => api.get<ActiveChallenges>('/challenges/active'),

  eligiblePhotos: () => api.get<{ photos: Photo[] }>('/challenges/eligible-photos'),

  /**
   * The caller's own wins, for the trophy case on their profile.
   *
   * A stranger's wins arrive inside `socialApi.publicProfile`, because a stranger's profile
   * is one request. Your own profile is assembled on the device out of stores that are
   * already loaded and makes no `publicProfile` call, so there is nothing to hang them off
   * and they get a request of their own.
   */
  wins: () => api.get<{ trophies: ChallengeTrophy[] }>('/challenges/wins'),

  entries: (challengeId: string) =>
    api.get<{ entries: PhotoWithAuthor[] }>(`/challenges/${challengeId}/entries`),

  submit: (challengeId: string, photoId: string) =>
    api.post<{ photo: Photo; alreadyEntered: boolean }>(
      `/challenges/${challengeId}/submit`,
      { photoId }
    ),
};

/* ----------------------------------- feed --------------------------------- */

export interface FeedQuery {
  scope?: 'everyone' | 'friends';
  cursor?: string;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

/** How far back the ranking looks. The server widens this when a window is too thin. */
export type ViralWindow = 'today' | 'week' | 'all';

export interface ViralQuery {
  window?: ViralWindow;
  /** A rank is a position in a computed ordering, so paging here is an offset, not a cursor. */
  offset?: number;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ViralPage {
  /** The rail. Empty on every page but the first. */
  trending: PhotoWithAuthor[];
  /** The wall below it. */
  rising: PhotoWithAuthor[];
  /** What the server actually ranked over — may be wider than what was asked for. */
  window: ViralWindow;
  nextOffset: number | null;
}

export const feedApi = {
  list: (query: FeedQuery = {}) =>
    api.get<{ photos: PhotoWithAuthor[]; nextCursor: string | null }>('/feed', { query }),

  /**
   * The ranked home feed.
   *
   * Sent **anonymously on purpose**. The response is public and identical for every
   * reader, so leaving the `Authorization` header off is what allows a CDN to serve it
   * from the edge — a request carrying a bearer token is uncacheable by definition, and at
   * scale that single header is the difference between one origin request per refresh
   * interval and one per user.
   *
   * The consequence is that `myReaction` arrives null on every photo. That is not missing
   * data: it is *this reader's own action*, which the client already knows, and
   * `reactionStore` overlays it. See the note there.
   */
  viral: (query: ViralQuery = {}, signal?: AbortSignal) =>
    api.get<ViralPage>('/feed/viral', { query, signal, anonymous: true }),
};

/* --------------------------------- social --------------------------------- */

export const socialApi = {
  leaderboard: (params: {
    scope: LeaderboardScope;
    metric: LeaderboardMetric;
    limit?: number;
  }) =>
    api.get<{
      entries: LeaderboardEntry[];
      bucket: string | null;
      computedAt: string | null;
    }>('/leaderboard', { query: params }),

  publicProfile: (userId: string) =>
    api.get<PublicProfile>(`/users/${userId}/public-profile`),

  friends: () =>
    api.get<{
      friends: User[];
      incoming: (User & { friendshipId: string })[];
      outgoing: User[];
    }>('/friends'),

  search: (q: string) => api.get<{ users: User[] }>('/users/search', { query: { q } }),

  addFriend: (username: string) =>
    api.post<{ status: 'pending' | 'accepted'; userId: string }>('/friends', { username }),

  respond: (friendshipId: string, accept: boolean) =>
    api.post<{ status: 'accepted' | 'declined' }>('/friends/respond', {
      friendshipId,
      accept,
    }),

  unfriend: (userId: string) => api.delete<void>(`/friends/${userId}`),
};

/* ---------------------------------- shop ---------------------------------- */

export interface CatalogResponse {
  proActive: boolean;
  photographerRank: number;
  /**
   * The wallet, sent with the catalogue rather than fetched separately.
   *
   * Every purchasable row has to know whether its paw price is within reach, and a second
   * request for that would mean two answers about one balance racing to render one screen.
   */
  walletBalance: number;
  items: ShopItem[];
}

export const shopApi = {
  catalog: () => api.get<CatalogResponse>('/shop/catalog'),

  /**
   * Buys one catalogue item with paws.
   *
   * **No price in the request.** The server charges the authored price and records what it
   * actually took, so a stale catalogue on this device cannot buy anything at yesterday's
   * number. Sends the id and nothing else.
   *
   * Answers with the whole catalogue rather than the one row, because one unlock moves more
   * than one row's state: the wallet falls, which can take every other paw price out of reach.
   *
   * Refusals worth telling apart by `code`: `already_owned`, `not_for_paws`, `no_paws`.
   */
  unlock: (entryId: string) =>
    api.post<CatalogResponse & { unlocked: string }>('/shop/unlock', { entryId }),

  purchase: (body: { platform: 'ios' | 'android'; productId: string; receipt: string }) =>
    api.post<CatalogResponse & { granted: boolean; alreadyApplied: boolean }>(
      '/shop/purchase',
      body
    ),
};
