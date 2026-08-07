import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * The service-role client. It bypasses row level security completely.
 *
 * Every query made through this object runs as the database owner, so a missing
 * `.eq('user_id', …)` is not a bug that returns too little — it is a bug that returns
 * everybody's rows. Services are responsible for scoping their own queries to the caller,
 * and `req.user.id` from the auth middleware is the only acceptable source for that id.
 *
 * Sessions are off: this client is never a signed-in user, it has no token to refresh, and
 * leaving persistence on in a server process means one request's auth state can leak into
 * the next one's.
 */
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
