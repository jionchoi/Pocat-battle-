import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { authApi } from '../api/endpoints';
import { ApiRequestError, configureAuth } from '../api/client';
import type { Me } from '../models';

/**
 * Auth session (README section 10).
 *
 * Tokens live in expo-secure-store — the Keychain on iOS, EncryptedSharedPreferences on
 * Android — never in AsyncStorage or MMKV, which are plain files on disk.
 */

const ACCESS_KEY = 'catsnap.accessToken';
const REFRESH_KEY = 'catsnap.refreshToken';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: Me | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  busy: boolean;

  hydrate: () => Promise<void>;
  signup: (params: {
    email: string;
    password: string;
    username: string;
  }) => Promise<void>;
  login: (params: { email: string; password: string }) => Promise<void>;
  socialLogin: (params: {
    provider: 'google' | 'apple';
    idToken: string;
  }) => Promise<{ isNewAccount: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUsername: (params: { username: string; avatarUrl?: string }) => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** Applied after a capture whose response already told us the new totals. */
  applyCaptureRewards: (params: { xpAwarded: number; scoreAwarded: number }) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  refreshToken: null,
  error: null,
  busy: false,

  /**
   * Called once from the splash screen. Restores the session and validates it against the
   * server, because a stored token may have been revoked while the app was closed.
   */
  hydrate: async () => {
    try {
      const [accessToken, refreshToken] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);

      if (!accessToken || !refreshToken) {
        set({ status: 'unauthenticated' });
        return;
      }

      set({ accessToken, refreshToken });

      const { user } = await authApi.me();
      set({ user, status: 'authenticated' });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 0) {
        // Offline at launch. Keep the stored session and let the player in — the album
        // is cached locally, so the app is usable until connectivity returns.
        set({
          status: get().accessToken ? 'authenticated' : 'unauthenticated',
          error: null,
        });
        return;
      }

      await clearTokens();
      set({ status: 'unauthenticated', user: null, accessToken: null, refreshToken: null });
    }
  },

  signup: async (params) => {
    set({ busy: true, error: null });
    try {
      const result = await authApi.signup(params);
      await persistTokens(result.accessToken, result.refreshToken);
      set({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        status: 'authenticated',
        busy: false,
      });
    } catch (err) {
      set({ busy: false, error: messageOf(err) });
      throw err;
    }
  },

  login: async (params) => {
    set({ busy: true, error: null });
    try {
      const result = await authApi.login(params);
      await persistTokens(result.accessToken, result.refreshToken);
      set({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        status: 'authenticated',
        busy: false,
      });
    } catch (err) {
      set({ busy: false, error: messageOf(err) });
      throw err;
    }
  },

  socialLogin: async (params) => {
    set({ busy: true, error: null });
    try {
      const result = await authApi.social(params);
      await persistTokens(result.accessToken, result.refreshToken);
      set({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        status: 'authenticated',
        busy: false,
      });
      return { isNewAccount: result.isNewAccount ?? false };
    } catch (err) {
      set({ busy: false, error: messageOf(err) });
      throw err;
    }
  },

  logout: async () => {
    const { refreshToken } = get();

    // Revoke server-side, but never block sign-out on the network. A player tapping
    // "sign out" must always end up signed out locally.
    if (refreshToken) {
      authApi.logout(refreshToken).catch(() => undefined);
    }

    await clearTokens();
    set({
      status: 'unauthenticated',
      user: null,
      accessToken: null,
      refreshToken: null,
      error: null,
    });
  },

  refreshUser: async () => {
    try {
      const { user } = await authApi.me();
      set({ user });
    } catch {
      // A failed profile refresh is not worth interrupting the player for.
    }
  },

  setUsername: async (params) => {
    set({ busy: true, error: null });
    try {
      const { user } = await authApi.setUsername(params);
      set({ user, busy: false });
    } catch (err) {
      set({ busy: false, error: messageOf(err) });
      throw err;
    }
  },

  deleteAccount: async () => {
    set({ busy: true, error: null });
    try {
      await authApi.deleteAccount();
      await clearTokens();
      set({
        status: 'unauthenticated',
        user: null,
        accessToken: null,
        refreshToken: null,
        busy: false,
      });
    } catch (err) {
      set({ busy: false, error: messageOf(err) });
      throw err;
    }
  },

  /**
   * Local nudge so the profile meter moves the instant a capture is scored, without a
   * second round trip. The authoritative rank comes back on the next `refreshUser`;
   * this only advances XP and the lifetime score, never the rank itself, because
   * recomputing a rank client-side would be the one number worth forging.
   */
  applyCaptureRewards: ({ xpAwarded, scoreAwarded }) => {
    const user = get().user;
    if (!user) return;

    set({
      user: {
        ...user,
        photographerXp: user.photographerXp + xpAwarded,
        lifetimeScore: user.lifetimeScore + scoreAwarded,
        xpToNextRank: Math.max(0, user.xpToNextRank - xpAwarded),
        photoCount: user.photoCount + 1,
      },
    });
  },

  clearError: () => set({ error: null }),
}));

async function persistTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
  ]);
}

async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

function messageOf(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return 'Something went wrong. Try again.';
}

/**
 * Give the API client access to the token and the refresh routine.
 *
 * Injected rather than imported so the dependency runs one way: the store imports the
 * client, and the client calls back into these closures.
 */
configureAuth({
  getAccessToken: () => useAuthStore.getState().accessToken,

  refreshTokens: async () => {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return null;

    try {
      const result = await authApi.refresh(refreshToken);
      await persistTokens(result.accessToken, result.refreshToken);
      useAuthStore.setState({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      return result.accessToken;
    } catch {
      // Refresh rotation failed, so the session is genuinely over. Signing out here is
      // what makes the navigator swap to the auth stack rather than looping on 401s.
      await clearTokens();
      useAuthStore.setState({
        status: 'unauthenticated',
        user: null,
        accessToken: null,
        refreshToken: null,
      });
      return null;
    }
  },
});
