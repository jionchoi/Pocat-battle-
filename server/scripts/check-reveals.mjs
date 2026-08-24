/**
 * One player's reveal ledger, next to the photographs it was spent on.
 *
 *     cd server && node scripts/check-reveals.mjs <username|user-id>
 *
 * This exists for the reveal-ledger refund test in `TESTING.md` §3 — score twice, delete one,
 * capture again, and the third capture must come back unscored. That test is the paywall: if a
 * delete refunds a reveal, the free tier is unlimited for anyone willing to delete what they
 * disliked. And its entire result, from a phone, is one bit — the capture came back scored, or
 * it did not.
 *
 * One bit is enough to know it failed and not enough to know why. The ledger not recording, the
 * delete taking its row with it, and the window arithmetic being wrong all look identical from
 * the app. This prints the rows so they stop looking identical.
 *
 * Read-only, and deliberately named outside the `check-*.ts` glob that runs keyless: like
 * `schema-state.mjs` this is a question about one database rather than about the rules.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import { REVEAL_LIMITS, REVEAL_WINDOW_HOURS } from '../src/game/scoring.ts';

dotenv.config();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server/.env is loaded).');
  process.exit(1);
}

const who = process.argv[2];

if (!who) {
  console.error('Usage: node scripts/check-reveals.mjs <username|user-id>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('id, username, pro_subscription_active')
  .eq(UUID.test(who) ? 'id' : 'username', who)
  .maybeSingle();

if (profileError) {
  console.error(`profiles: ${profileError.code ?? ''} ${profileError.message}`);
  process.exit(1);
}

if (!profile) {
  console.error(`No profile matches ${who}.`);
  process.exit(1);
}

const short = (id) => (id ? id.slice(0, 8) : '—');
const when = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '—');

console.log(`\n${SUPABASE_URL}`);
console.log(`player  ${profile.username ?? '(no username)'}  ${profile.id}`);
console.log(`tier    ${profile.pro_subscription_active ? 'pro' : 'free'}\n`);

/* -------------------------------------------------------------------------- */
/* The allowance, computed the way the server computes it                     */
/* -------------------------------------------------------------------------- */

/*
 * Mirrors `revealAllowance` in src/services/photos.ts rather than calling it — that function
 * reaches for the shared client and the whole config, which would drag the server's env
 * validation into a script whose only job is to read two tables. The cost is that the two can
 * drift, so the constants at least come from the same file the server imports.
 */
const since = new Date(Date.now() - REVEAL_WINDOW_HOURS * 3600_000).toISOString();

const { data: reveals, error: revealsError } = await supabase
  .from('reveals')
  .select('id, photo_id, scored_at')
  .eq('user_id', profile.id)
  .order('scored_at', { ascending: false })
  .limit(50);

if (revealsError) {
  console.error(`reveals: ${revealsError.code ?? ''} ${revealsError.message}`);
  process.exit(1);
}

const inWindow = reveals.filter((r) => r.scored_at >= since);
const limit = profile.pro_subscription_active ? REVEAL_LIMITS.pro : REVEAL_LIMITS.free;
const used = inWindow.length;

console.log(`reveals — ${REVEAL_WINDOW_HOURS}h window opens ${when(since)}`);
console.log(
  limit === null
    ? `  limit unlimited   used ${used}`
    : `  limit ${limit}   used ${used}   remaining ${Math.max(0, limit - used)}`
);

// The oldest reveal in the window is the one that frees a slot when it ages out.
const oldestInWindow = inWindow[inWindow.length - 1];

if (limit !== null && used >= limit && oldestInWindow) {
  console.log(
    `  spent — resets ${when(
      new Date(new Date(oldestInWindow.scored_at).getTime() + REVEAL_WINDOW_HOURS * 3600_000)
    )}`
  );
}

console.log();

if (reveals.length === 0) {
  console.log('  no ledger rows at all — nothing has ever been scored by this player\n');
} else {
  for (const r of reveals) {
    const window = r.scored_at >= since ? 'in window ' : 'aged out  ';
    /*
     * `photo_id` null is the signature of a delete that behaved: ON DELETE SET NULL, so the row
     * outlives the photograph and forgets which one it was. A delete that *refunded* the reveal
     * would show up as this line being absent entirely.
     */
    const photo = r.photo_id ? short(r.photo_id) : 'orphaned (photo deleted)';
    console.log(`  ${when(r.scored_at)}  ${window} ${photo}`);
  }
  console.log();
}

/* -------------------------------------------------------------------------- */
/* The photographs                                                            */
/* -------------------------------------------------------------------------- */

/*
 * Deletes are hard, so a photo missing from here is genuinely gone. Reading both sides is the
 * point: the refund test passes when a reveal row has no photo to point at, and fails when the
 * photo and its ledger row disappeared together.
 */
const { data: photos, error: photosError } = await supabase
  .from('photos')
  .select('id, captured_at, scored_at, score_total, scoring_model, no_cat_at, scoring_attempts')
  .eq('owner_id', profile.id)
  .order('captured_at', { ascending: false })
  .limit(20);

if (photosError) {
  console.error(`photos: ${photosError.code ?? ''} ${photosError.message}`);
  process.exit(1);
}

console.log(`photos — ${photos.length} most recent`);
console.log();

if (photos.length === 0) {
  console.log('  none\n');
} else {
  const charged = new Set(reveals.filter((r) => r.photo_id).map((r) => r.photo_id));

  for (const p of photos) {
    const state = p.no_cat_at
      ? `no cat @ ${when(p.no_cat_at)}`
      : p.scored_at
        ? `scored ${String(p.score_total).padStart(3)} (${p.scoring_model}) @ ${when(p.scored_at)}`
        : 'unscored';

    /*
     * A scored photo with no ledger row is the one inconsistency neither table can show alone:
     * the score was written and never charged. `scoreLater` logs that case and continues on
     * purpose — a player who paid nothing is better than a player charged for a score they
     * cannot see — so it is invisible unless something looks for it.
     */
    const uncharged = p.scored_at && !charged.has(p.id) ? '  ← SCORED BUT NOT CHARGED' : '';

    const attempts = p.scoring_attempts > 1 ? `  ${p.scoring_attempts} attempts` : '';

    console.log(`  ${short(p.id)}  ${when(p.captured_at)}  ${state}${attempts}${uncharged}`);
  }
  console.log();
}
