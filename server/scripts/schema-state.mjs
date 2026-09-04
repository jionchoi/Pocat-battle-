/**
 * Which migrations are actually applied to the live project.
 *
 *     cd server && node scripts/schema-state.mjs
 *
 * This exists because the answer has been *guessed* for most of this project's life.
 * `BACKEND.md` §3 carried a hand-maintained list of which files had been run, kept in step by
 * somebody remembering to update it, and inferred the rest from "a capture could not have
 * succeeded without this column, and captures have". That reasoning was sound and it was still
 * a guess, and a wrong guess sends a session off building on a table that is not there.
 *
 * Unlike everything under `check-*.ts`, this one needs the project and the service-role key —
 * it is a question about a specific database rather than about the rules. It is deliberately
 * named outside that glob so `for f in scripts/check-*.ts` stays keyless.
 *
 * Read-only. It selects one row, zero columns wide, from each table a migration creates.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server/.env is loaded).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Each migration, and something that only exists once it has run.
 *
 * A column is probed by selecting it; PostgREST answers `42703` for one that is not there. A
 * table is probed the same way on its primary key.
 *
 * `friendships` is one of the interesting ones. It is created in the *third* block of
 * `2026-08-13_social_and_account.sql`, after the column grant that closes trap 17 — so the
 * table existing proves the grant ran, which is not otherwise checkable from out here.
 *
 * ## What this cannot see
 *
 * `2026-08-28_five_reactions.sql` widens a check constraint and creates nothing, so there is
 * no table or column to select and it has no row below. A probe for it would have to *write* a
 * vote with `reaction = 'melt'` and read the error, and this script is read-only on purpose —
 * a schema probe that inserts rows is a schema probe nobody runs against production. Until
 * that migration is applied, 🥹 and 🔥 answer a check-constraint violation on the tap and this
 * script will happily say every migration is applied.
 *
 * **Add a row here whenever a migration creates something.** This list is hand-maintained, and
 * a hand-maintained list of what is applied is exactly what was wrong on 2026-08-14 — the
 * difference is that being wrong *here* is one line, where being wrong in a markdown file cost
 * a day.
 */
const PROBES = [
  ['2026-08-07_create_profiles', 'profiles', 'id'],
  ['2026-08-07_create_photos_and_cats', 'photos', 'id'],
  ['2026-08-10_photos_shared_to_map', 'photos', 'shared_to_map'],
  ['2026-08-10_reveal_ledger', 'reveals', 'id'],
  ['2026-08-12_scoring_guards', 'photos', 'no_cat_at'],
  ['2026-08-12_community_layer (votes)', 'votes', 'id'],
  ['2026-08-12_community_layer (counters)', 'photos', 'community_score'],
  ['2026-08-12_challenges', 'challenges', 'id'],
  ['2026-08-12_challenges (entries)', 'challenge_entries', 'id'],
  ['2026-08-13_social_and_account (settings)', 'profiles', 'home_lat'],
  ['2026-08-13_social_and_account (friendships + the grant)', 'friendships', 'id'],
  ['2026-08-29_paws (grants)', 'paw_grants', 'user_id'],
  ['2026-08-29_paws (ledger)', 'paw_ledger', 'id'],
  ['2026-08-29_paws (counter)', 'photos', 'paw_count'],
  ['2026-08-30_paw_spending (entitlements)', 'entitlements', 'user_id'],
  ['2026-08-30_paw_spending (ledger entry_id)', 'paw_ledger', 'entry_id'],
  ['2026-08-31_reveal_attribution', 'photos', 'revealed_by'],
];

let missing = 0;

console.log(`\nchecking ${SUPABASE_URL}\n`);

for (const [label, table, column] of PROBES) {
  const { error } = await supabase.from(table).select(column).limit(1);

  if (!error) {
    console.log(`applied      ${label}`);
    continue;
  }

  // 42P01 is an undefined table, 42703 an undefined column. Anything else is a real problem
  // with the connection or the policy rather than an answer about the schema.
  if (error.code === '42P01' || error.code === '42703' || /does not exist/i.test(error.message)) {
    missing += 1;
    console.log(`NOT APPLIED  ${label}  (${table}.${column})`);
    continue;
  }

  missing += 1;
  console.log(`ERROR        ${label}  ${error.code ?? ''} ${error.message}`);
}

console.log(
  missing === 0
    ? '\nEvery migration is applied.\n'
    : `\n${missing} probe(s) came back missing — see above.\n`
);

process.exit(missing === 0 ? 0 : 1);
