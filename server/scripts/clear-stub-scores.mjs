/**
 * Finds — and optionally undoes — every score that was invented locally.
 *
 *     cd server && node scripts/clear-stub-scores.mjs           # report only
 *     cd server && node scripts/clear-stub-scores.mjs --clear    # actually do it
 *
 * The whole capture loop was built against `SCORING_STUB=true`, which stamps `scoring_model`
 * as `'stub'` on every row it touches. Those numbers are plausible and completely made up, and
 * they sit in the same columns the leaderboard ranks on — so the day a real key is added, they
 * are the only thing standing between a working scorer and a leaderboard built on noise.
 *
 * ## Why this clears rather than deletes
 *
 * The photographs are the player's. Deleting a stub-scored row destroys somebody's picture to
 * fix our bookkeeping, which is never the right trade. Clearing the score puts the row back
 * into the state the schema already has a shape for — unscored, revealable — and the player
 * gets a real number the next time they open it.
 *
 * ## Why it also deletes the matching ledger rows
 *
 * `reveals` exists so that deleting a photograph does not refund its reveal, and nothing in
 * the product should ever remove a row from it. This is the exception, and it is narrow: a
 * player who spent a reveal on a stub score paid for a number we are now taking away, and
 * leaving the ledger row would charge them twice for one photograph. The rows removed are only
 * those pointing at photos being cleared in the same run.
 *
 * Never operates on anything whose `scoring_model` is not exactly 'stub'.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server/.env is loaded).');
  process.exit(1);
}

const apply = process.argv.includes('--clear');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: rows, error } = await supabase
  .from('photos')
  .select('id, owner_id, score_total, scored_at, scoring_version')
  .eq('scoring_model', 'stub');

if (error) {
  console.error('Could not read photos:', error.message);
  process.exit(1);
}

if (rows.length === 0) {
  console.log('No stub-scored photos. Nothing to do.');
  process.exit(0);
}

const owners = new Set(rows.map((row) => row.owner_id));

console.log(`\n${rows.length} stub-scored photo(s), across ${owners.size} player(s).`);
console.log(`Totals range ${Math.min(...rows.map((r) => r.score_total ?? 0))}`
  + `–${Math.max(...rows.map((r) => r.score_total ?? 0))}.\n`);

if (!apply) {
  console.log('Dry run. Re-run with --clear to unset these scores and refund their reveals.\n');
  process.exit(0);
}

const ids = rows.map((row) => row.id);

/*
 * Every score column together, because `photos_scored_together` will not accept a row that is
 * half scored — the same constraint that stops a partial write on the way in stops a partial
 * undo on the way out.
 *
 * `scoring_attempts` goes back to zero too. The attempts that produced these never cost
 * anything, and leaving the counter at 1 would spend a third of a photograph's real budget on
 * calls that were never made.
 */
const { error: clearError } = await supabase
  .from('photos')
  .update({
    score_composition: null,
    score_pose_rarity: null,
    score_cat_rarity: null,
    score_bonus: null,
    score_total: null,
    tier: null,
    pose: null,
    badges: [],
    scored_at: null,
    scoring_model: null,
    scoring_version: null,
    scoring_attempts: 0,
  })
  .in('id', ids);

if (clearError) {
  console.error('Could not clear scores:', clearError.message);
  process.exit(1);
}

console.log(`Cleared ${ids.length} score(s).`);

const { error: ledgerError, count } = await supabase
  .from('reveals')
  .delete({ count: 'exact' })
  .in('photo_id', ids);

if (ledgerError) {
  console.error(
    'Scores are cleared but the ledger was not: ' + ledgerError.message +
      '\nThose players are down a reveal until this is re-run.'
  );
  process.exit(1);
}

console.log(`Refunded ${count ?? 0} reveal(s).`);
console.log('\nThese photos are now unscored and revealable. Set SCORING_STUB=false first.\n');
