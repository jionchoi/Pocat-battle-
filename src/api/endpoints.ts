import type {
  Cat,
  CatProfile,
  Challenge,
  CatSighting,
  GeoPoint,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardScope,
  Me,
  Photo,
  PhotoSubmission,
  PhotoSubmissionResult,
  PhotoWithAuthor,
  PublicProfile,
  Rarity,
  Reaction,
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

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Me;
  isNewAccount?: boolean;
}

export interface NotificationPreferences {
  shareCapturesByDefault: boolean;
  pushChallengeResults: boolean;
  pushVotes: boolean;
  pushNearbyRareCats: boolean;
}

export const authApi = {
  signup: (body: { email: string; password: string; username: string }) =>
    api.post<AuthResponse>('/auth/signup', body, { anonymous: true }),

  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', body, { anonymous: true }),

  social: (body: { provider: 'google' | 'apple'; idToken: string }) =>
    api.post<AuthResponse>('/auth/social', body, { anonymous: true }),

  refresh: (refreshToken: string) =>
    api.post<{ accessToken: string; refreshToken: string; expiresIn: number }>(
      '/auth/refresh',
      { refreshToken },
      { anonymous: true }
    ),

  logout: (refreshToken: string) =>
    api.post<void>('/auth/logout', { refreshToken }, { anonymous: true }),

  me: () => api.get<{ user: Me }>('/auth/me'),

  setUsername: (body: { username: string; avatarUrl?: string }) =>
    api.patch<{ user: Me }>('/auth/username', body),

  setPushToken: (token: string) => api.put<void>('/auth/push-token', { token }),

  setHomeLocation: (body: GeoPoint) => api.put<void>('/auth/home-location', body),

  preferences: () =>
    api.get<{ preferences: NotificationPreferences }>('/auth/preferences'),

  setPreferences: (body: Partial<NotificationPreferences>) =>
    api.patch<{ preferences: NotificationPreferences }>('/auth/preferences', body),

  deleteAccount: () => api.delete<void>('/auth/account'),
};

/* --------------------------------- photos --------------------------------- */

export const photoApi = {
  submit: (body: PhotoSubmission) =>
    api.post<PhotoSubmissionResult>('/photos', body, {
      // A photo upload plus a Vision round trip plus a caption call is slow on mobile
      // data. This has to outlast all three or a good capture is lost to a timeout.
      timeoutMs: 45_000,
    }),

  detail: (photoId: string) => api.get<{ photo: Photo }>(`/photos/${photoId}`),

  update: (
    photoId: string,
    body: { caption?: string; sharedToFeed?: boolean; showcased?: boolean }
  ) => api.patch<{ photo: Photo }>(`/photos/${photoId}`, body),

  remove: (photoId: string) => api.delete<void>(`/photos/${photoId}`),

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

  update: (catId: string, body: { nickname?: string; bio?: string }) =>
    api.patch<{ cat: Cat }>(`/catdex/${catId}`, body),
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

export const challengeApi = {
  active: () => api.get<{ active: Challenge[]; past: Challenge[] }>('/challenges/active'),

  eligiblePhotos: () => api.get<{ photos: Photo[] }>('/challenges/eligible-photos'),

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
  items: ShopItem[];
}

export const shopApi = {
  catalog: () => api.get<CatalogResponse>('/shop/catalog'),

  purchase: (body: { platform: 'ios' | 'android'; productId: string; receipt: string }) =>
    api.post<CatalogResponse & { granted: boolean; alreadyApplied: boolean }>(
      '/shop/purchase',
      body
    ),
};
