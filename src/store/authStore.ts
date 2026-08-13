import { create } from 'zustand';
import type { AuthError, Session } from '@supabase/supabase-js';

import { configureAuth } from '../api/client';
import { authApi } from '../api/endpoints';
import { supabase } from '../lib/supabase';
import { ProfileMissingError, fetchMe, saveOnboarding } from '../lib/profile';
import type { CaptureAward, Me } from '../models';

/**
 * Auth session.
 *
 * Supabase owns the session now. This store owns two things it cannot: the player's
 * profile, and the single `status` the navigator switches on.
 *
 * ## What changed, and why the tokens left secure storage
 *
 * This used to mint, persist and rotate its own access and refresh tokens in
 * expo-secure-store. All of that is gone — issuing, refreshing and revoking are the
 * platform's job, and every line of it we kept was security-critical code with no product
 * in it. The session now lives in AsyncStorage because that is what the SDK supports; see
 * the note in lib/supabase.ts for why that is an acceptable trade and not an oversight.
 *
 * ## Nothing here polls
 *
 * `onAuthStateChange` is the only source of truth about whether somebody is signed in. It
 * fires on restore at launch, on sign-in, on sign-out, and on every token refresh —
 * including refreshes this app did not ask for. Deriving `status` from anywhere else means
 * two answers to one question, which is how a signed-out player ends up looking at a
 * cached profile.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: Me | null;
  session: Session | null;
  /**
   * Signed in, and we know there is no profile to load — as opposed to not knowing.
   *
   * The navigator needs to tell those apart. A player whose row does not exist belongs on
   * the setup screen; a player whose fetch failed on a bad network belongs wherever they
   * were, because guessing wrong sends an established account back through onboarding.
   */
  profileMissing: boolean;
  error: string | null;
  busy: boolean;

  /** Starts listening. Called once, from App. */
  hydrate: () => Promise<void>;
  signup: (params: { email: string; password: string }) => Promise<void>;
  login: (params: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** The onboarding step: the username a player picks, and their avatar. */
  setUsername: (params: { username: string; avatarUrl?: string }) => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** Applied after a capture whose response already told us the new totals. */
  applyCaptureRewards: (params: { award: CaptureAward; scoreAwarded: number }) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  session: null,
  profileMissing: false,
  error: null,
  busy: false,

  hydrate: async () => {
    /*
     * Subscribe before reading.
     *
     * `getSession` reads what is on disk and the SDK may refresh it a moment later. A
     * listener attached afterwards would miss that first event, and the app would run on
     * an access token it had already replaced.
     */
    supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session, set, get);
    });

    const { data } = await supabase.auth.getSession();
    await applySession(data.session, set, get);
  },

  /**
   * Signing up does not ask for a username.
   *
   * It is chosen on the setup screen, after the account exists — which is why the profile
   * row is created by a database trigger with `username` null, and why the navigator holds
   * a player there until they pick one.
   */
  signup: async ({ email, password }) => {
    set({ busy: true, error: null });

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      set({ busy: false, error: messageOf(error) });
      throw error;
    }

    // `onAuthStateChange` sets the user and the status. Only `busy` belongs to this call.
    set({ busy: false });
  },

  login: async ({ email, password }) => {
    set({ busy: true, error: null });

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      set({ busy: false, error: messageOf(error) });
      throw error;
    }

    set({ busy: false });
  },

  logout: async () => {
    /*
     * Local state is cleared here rather than left to the listener. Sign-out has to be
     * instant and unconditional — a player tapping it on a dead network must still end up
     * signed out, and `signOut` can reject when it cannot reach the server.
     */
    set({
      status: 'unauthenticated',
      user: null,
      session: null,
      profileMissing: false,
      error: null,
    });
    await supabase.auth.signOut().catch(() => undefined);
  },

  refreshUser: async () => {
    const session = get().session;
    if (!session) return;

    try {
      const user = await fetchMe(session.user.id, session.user.email ?? null);
      set({ user });
    } catch {
      // A failed profile refresh is not worth interrupting the player for.
    }
  },

  setUsername: async ({ username, avatarUrl }) => {
    const session = get().session;
    if (!session) return;

    set({ busy: true, error: null });

    try {
      await saveOnboarding({ userId: session.user.id, username, avatarUrl });
      const user = await fetchMe(session.user.id, session.user.email ?? null);
      set({ user, profileMissing: false, busy: false });
    } catch (err) {
      set({ busy: false, error: messageOf(err) });
      throw err;
    }
  },

  /**
   * Deleting an account is the one auth action the app cannot perform itself.
   *
   * Removing a row from `auth.users` needs the admin API, which needs the service-role
   * key, which must never be in a bundle. So it goes through our server, which holds that
   * key — and the cascade on both tables takes the profile and the stats with it.
   *
   * The route does not exist yet. Until it does this reports a clear failure rather than
   * pretending, because the alternative is a screen that says an account is gone while it
   * is still there.
   */
  deleteAccount: async () => {
    set({ busy: true, error: null });

    try {
      await authApi.deleteAccount();
      set({
        status: 'unauthenticated',
        user: null,
        session: null,
        profileMissing: false,
        busy: false,
      });
      await supabase.auth.signOut().catch(() => undefined);
    } catch (err) {
      set({ busy: false, error: messageOf(err) });
      throw err;
    }
  },

  /**
   * Applies what a capture actually earned, so the profile meter is right immediately.
   *
   * This used to be a local *guess* — add the XP, subtract it from the distance to the next
   * rank, leave the rank alone because "recomputing a rank client-side would be the one
   * number worth forging". It was also never called from anywhere, which is the more useful
   * half of the story: it was written before anything awarded XP, and there was nothing to
   * hand it.
   *
   * Now the server sends the totals it just wrote, so nothing here is computed. The rank is
   * assigned rather than derived for exactly the old reason — the ramp is mirrored on both
   * sides so a meter can be drawn offline, and when the two disagree the server is right.
   *
   * `lifetimeScore` and `photoCount` are still increments: neither is on the award, because
   * neither is progression. They are corrected by the next `refreshUser` either way.
   */
  applyCaptureRewards: ({ award, scoreAwarded }) => {
    const user = get().user;
    if (!user) return;

    set({
      user: {
        ...user,
        photographerXp: award.xp,
        photographerRank: award.rank,
        xpToNextRank: award.xpToNextRank,
        lifetimeScore: user.lifetimeScore + scoreAwarded,
        photoCount: user.photoCount + 1,
      },
    });
  },

  clearError: () => set({ error: null }),
}));

/**
 * The one place `status` is decided.
 *
 * Signed out is immediate. Signed in waits for the profile, because the navigator's setup
 * gate reads `user.username` — flipping to `authenticated` with a null user would show the
 * main tabs for one frame before bouncing a new account to the setup screen.
 *
 * A profile that fails to load is not treated as signed out. The session is real, the
 * device may simply be offline at launch, and dropping someone to the sign-in screen
 * because a fetch timed out would ask them to re-enter a password they had never lost.
 */
async function applySession(
  session: Session | null,
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState
): Promise<void> {
  if (!session) {
    set({ status: 'unauthenticated', user: null, session: null, profileMissing: false });
    return;
  }

  set({ session });

  // A token refresh fires this again with a profile already in hand. Refetching on every
  // refresh would put a network call on a timer for no new information.
  if (get().user?.id === session.user.id) {
    set({ status: 'authenticated' });
    return;
  }

  try {
    const user = await fetchMe(session.user.id, session.user.email ?? null);
    set({ user, profileMissing: false, status: 'authenticated' });
  } catch (err) {
    /*
     * Two failures that look alike and must not be treated alike.
     *
     * No row means setup never finished, and the navigator sends them to it. Anything else
     * — a timeout, a dropped connection — means we do not know, so the session stands and
     * the player carries on with whatever is cached rather than being asked to set up an
     * account they set up months ago.
     */
    if (!(err instanceof ProfileMissingError)) {
      /*
       * Logged, because this branch is where a real failure goes to be quiet. A schema or
       * policy mistake arrives here looking exactly like a flaky network, and the symptom
       * is an app that opens on an empty home screen with nothing said about why.
       */
      console.warn('[auth] could not load profile:', err);
    }

    set({
      status: 'authenticated',
      profileMissing: err instanceof ProfileMissingError,
    });
  }
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as AuthError).message);
  }
  return 'Something went wrong. Try again.';
}

/**
 * Give the API client the session's access token.
 *
 * Injected rather than imported so the dependency runs one way: the store imports the
 * client, and the client calls back into these closures.
 *
 * `getSession` rather than the stored session: the SDK refreshes on its own schedule, and
 * asking it at call time is the difference between sending the current token and sending
 * whatever this store last happened to see. It resolves from memory unless the token is
 * expired, in which case it refreshes — which is also the entire refresh path, so the two
 * are the same call.
 */
configureAuth({
  getAccessToken: () => useAuthStore.getState().session?.access_token ?? null,

  refreshTokens: async () => {
    const { data } = await supabase.auth.getSession();

    if (!data.session) {
      useAuthStore.setState({ status: 'unauthenticated', user: null, session: null });
      return null;
    }

    useAuthStore.setState({ session: data.session });
    return data.session.access_token;
  },
});
