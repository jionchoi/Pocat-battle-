import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

/**
 * The app's Supabase client.
 *
 * It holds the session and nothing else. Reads of a player's own identity go through it
 * because row level security already says exactly who may see what; anything that decides
 * a score goes to our own API instead, because a policy can say which rows you may write
 * but not what a photograph is worth.
 *
 * ## The keys here are public, and that is the design
 *
 * `EXPO_PUBLIC_*` values are inlined into the JavaScript bundle at build time, so the anon
 * key ships inside the app and can be read straight out of the binary. It carries no
 * privileges of its own — what a request may actually do is decided by RLS and by the
 * signed-in user's token. That is precisely why every table denies by default. The
 * service-role key never appears on this side of the wire.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  /*
   * Thrown at import rather than tolerated, because the failure it prevents is much worse
   * than a crash on launch: a client built without these silently treats every signed-in
   * request as anonymous, and the first symptom is an empty screen that looks like a bug
   * in a query.
   */
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and restart the bundler — these are inlined at build ' +
      'time, so a running bundler will not pick them up.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    /*
     * AsyncStorage, not SecureStore.
     *
     * This is a deliberate step down from where the old hand-rolled tokens lived, and it
     * is the officially supported storage for this SDK: the client reads and writes the
     * session synchronously on every request, and SecureStore's Keychain round trip is
     * neither synchronous nor cheap enough for that. What is stored is a short-lived
     * access token and a rotating refresh token, not a password.
     */
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    /*
     * Off, because this is not a browser. There is no URL bar for a session to arrive in,
     * and leaving it on makes the SDK look for one on every launch.
     */
    detectSessionInUrl: false,
  },
});

/**
 * Refresh only while the app is in front of the player.
 *
 * The SDK's auto-refresh runs on a timer, and a timer in a backgrounded React Native app
 * is not a thing you can rely on — iOS suspends it, and it wakes up firing a refresh with
 * a token that expired an hour ago. Stopping on background and restarting on foreground
 * makes the refresh happen when there is a live network and a screen to show the result on.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
