/**
 * The Cat Dex patch schema, checked without a database.
 *
 * `PATCH /catdex/:catId` is the one Dex endpoint that takes a body, and the body is the
 * boundary that decides which columns a player may write. That boundary is drawn three times
 * on purpose — the column grant in the migration, `DexPatch` in the service, and this schema —
 * and this file is the only one of the three that can be *run*.
 *
 * Everything here is a pure function of its input, so it needs no Supabase project and no
 * network. Run it with:
 *
 *     cd server && npx tsx scripts/check-catdex.ts
 *
 * It exits non-zero on the first failing expectation, so it is usable as a check rather than
 * only as something to read.
 */

import { updateCatSchema } from '../src/controllers/catdex.js';

const UUID = '11111111-2222-4333-8444-555555555555';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`)
  );
}

/** Accepted, and the value the service will actually receive. */
function accepts(label: string, body: unknown, expected: Record<string, unknown>): void {
  const parsed = updateCatSchema.safeParse(body);

  if (!parsed.success) {
    failures += 1;
    console.log(`FAIL  ${label}\n        expected it to parse, got ${parsed.error.issues[0]?.message}`);
    return;
  }

  // Keys the schema left as `undefined` are absent as far as the service is concerned, and
  // comparing them would be comparing zod's internals rather than behaviour.
  const defined = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  );

  check(label, defined, expected);
}

function rejects(label: string, body: unknown): void {
  const parsed = updateCatSchema.safeParse(body);
  check(label, parsed.success, false);
}

console.log('\n-- what a player may write --\n');

accepts('empty patch is a no-op, not an error', {}, {});
accepts('nickname alone', { nickname: 'Mochi' }, { nickname: 'Mochi' });
accepts('nickname is trimmed', { nickname: '  Mochi  ' }, { nickname: 'Mochi' });
accepts('bio alone', { bio: 'Sleeps on the wall' }, { bio: 'Sleeps on the wall' });
accepts('nickname and bio together', { nickname: 'Mochi', bio: 'Loud' }, { nickname: 'Mochi', bio: 'Loud' });
accepts('pinning a photo', { bestPhotoId: UUID }, { bestPhotoId: UUID });
accepts('releasing the pin', { bestPhotoPinned: false }, { bestPhotoPinned: false });
accepts('a rename that also pins', { nickname: 'Mochi', bestPhotoId: UUID }, { nickname: 'Mochi', bestPhotoId: UUID });

console.log('\n-- clearing a bio is not the same as omitting it --\n');

/*
 * The distinction the whole `bio` transform exists for. An absent key must leave a written
 * bio alone; an empty string is a player who deleted theirs, and has to reach the column as
 * null so there is one representation of "no bio" rather than two.
 */
accepts('empty bio clears it, as null', { bio: '' }, { bio: null });
accepts('whitespace-only bio also clears it', { bio: '   ' }, { bio: null });
accepts('absent bio is absent, not a clear', { nickname: 'Mochi' }, { nickname: 'Mochi' });

console.log('\n-- the column grant, restated --\n');

/*
 * The important one. `encounter_count`, `best_photo_score` and `best_tier` are computed by the
 * server and revoked from the client in the migration; a plain `z.object` would strip them
 * silently, which reads as acceptance. Trap 16 in BACKEND.md is this same mistake found the
 * hard way on `identifySchema`.
 */
rejects('encounterCount is not the player\'s to set', { encounterCount: 99 });
rejects('bestPhotoScore is not the player\'s to set', { bestPhotoScore: 100 });
rejects('bestTier is not the player\'s to set', { bestTier: 'Legendary' });
rejects('userId cannot be smuggled in a body', { userId: UUID });
rejects('an unknown key is refused rather than stripped', { nickanme: 'typo' });

console.log('\n-- bounds match the column constraints --\n');

rejects('empty nickname (constraint: 1..30)', { nickname: '' });
rejects('whitespace-only nickname', { nickname: '   ' });
rejects('nickname over 30', { nickname: 'x'.repeat(31) });
accepts('nickname at exactly 30', { nickname: 'x'.repeat(30) }, { nickname: 'x'.repeat(30) });
rejects('bio over 200', { bio: 'x'.repeat(201) });
accepts('bio at exactly 200', { bio: 'x'.repeat(200) }, { bio: 'x'.repeat(200) });

console.log('\n-- pinning --\n');

rejects('bestPhotoId must be a uuid', { bestPhotoId: 'the-good-one' });
/*
 * `true` has no photograph attached to it, so it is a request that cannot be carried out.
 * Pinning is done by naming the photo; only the release is a boolean.
 */
rejects('bestPhotoPinned: true is not a thing you can ask for', { bestPhotoPinned: true });
rejects('pinning and releasing in one request', { bestPhotoId: UUID, bestPhotoPinned: false });

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
