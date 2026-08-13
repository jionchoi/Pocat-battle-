/**
 * `ilike` pattern building, checked without a database.
 *
 *     cd server && npx tsx scripts/check-search.ts
 *
 * Three services build `ilike` patterns from something a player typed, and each wants a
 * different shape — which is why the escaping was written out three times and why one of the
 * three did not have it. `services/friends.ts` passed a raw username, so `mo_hi` matched
 * `mochi`; that is what this file exists to keep fixed.
 *
 * Exits non-zero on any failure.
 */

import { containsPattern, escapeLike, prefixPattern } from '../src/lib/search.js';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok
        ? ''
        : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`)
  );
}

/**
 * Does this pattern match this value, under Postgres' LIKE semantics?
 *
 * A local model of the operator, so the assertions below can be about *matching* rather than
 * about the shape of a string. Backslash escapes the next character; unescaped `%` and `_` are
 * the wildcards. Case-insensitive, because every call site uses `ilike`.
 */
function ilikeMatches(pattern: string, value: string): boolean {
  let regex = '';

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;

    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next !== undefined) {
        regex += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        i += 1;
      }
      continue;
    }

    if (ch === '%') regex += '.*';
    else if (ch === '_') regex += '.';
    else regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${regex}$`, 'i').test(value);
}

console.log('\n-- the model of ilike itself --\n');

check('an unescaped _ is a wildcard', ilikeMatches('mo_hi', 'mochi'), true);
check('an unescaped % is a wildcard', ilikeMatches('mo%', 'mochi'), true);
check('an escaped _ is a literal', ilikeMatches('mo\\_hi', 'mochi'), false);
check('an escaped _ matches the character', ilikeMatches('mo\\_hi', 'mo_hi'), true);
check('matching is case-insensitive', ilikeMatches('mochi', 'MOCHI'), true);

console.log('\n-- escapeLike adds no wildcards of its own --\n');

check('a plain term is unchanged', escapeLike('mochi'), 'mochi');
check('an underscore is escaped', escapeLike('mo_hi'), 'mo\\_hi');
check('a percent is escaped', escapeLike('100%'), '100\\%');
check('a backslash is escaped', escapeLike('a\\b'), 'a\\\\b');
check('several at once', escapeLike('a_b%c'), 'a\\_b\\%c');
check('the empty term stays empty', escapeLike(''), '');

console.log('\n-- the bug this file exists for --\n');

/*
 * `_` is legal in a username — `profiles_username_charset` permits `[A-Za-z0-9_]` — so this is
 * not a hypothetical character somebody would have to go looking for. Adding `mo_hi` as a
 * friend used to send the request to `mochi`.
 */
check('an exact lookup no longer matches a different name', ilikeMatches(escapeLike('mo_hi'), 'mochi'), false);
check('an exact lookup still matches its own name', ilikeMatches(escapeLike('mo_hi'), 'mo_hi'), true);
check('and does so case-insensitively', ilikeMatches(escapeLike('mo_hi'), 'MO_HI'), true);
check('an exact lookup does not match a longer name', ilikeMatches(escapeLike('mochi'), 'mochi2'), false);
check('a bare % cannot match everybody', ilikeMatches(escapeLike('%'), 'anybody'), false);

console.log('\n-- prefixPattern: user search --\n');

check('matches a name that starts with the term', ilikeMatches(prefixPattern('mo'), 'mochi'), true);
check('matches the term exactly', ilikeMatches(prefixPattern('mochi'), 'mochi'), true);
check('does not match mid-word', ilikeMatches(prefixPattern('chi'), 'mochi'), false);
/*
 * The privacy property, not an index one. A contains-match would let somebody enumerate the
 * user table a couple of letters at a time; anchoring to the front means the search only
 * answers people looking for a name they already partly know.
 */
check('a term cannot be turned into a contains-match with %', ilikeMatches(prefixPattern('%chi'), 'mochi'), false);
check('an underscore in a search term is literal', ilikeMatches(prefixPattern('mo_'), 'mochi'), false);
check('and finds the account actually named that', ilikeMatches(prefixPattern('mo_'), 'mo_hi'), true);

console.log('\n-- containsPattern: the album cat-name filter --\n');

check('matches mid-word, which is the point', ilikeMatches(containsPattern('chi'), 'mochi'), true);
check('matches at the front', ilikeMatches(containsPattern('mo'), 'mochi'), true);
check('matches the whole value', ilikeMatches(containsPattern('mochi'), 'mochi'), true);
check('does not match an unrelated name', ilikeMatches(containsPattern('biscuit'), 'mochi'), false);
/*
 * A nickname is free text, so `%` and `_` are far likelier here than in a username — somebody
 * really does call a cat "100%".
 */
check('a percent in a nickname search is literal', ilikeMatches(containsPattern('100%'), '100% Trouble'), true);
check('and does not match without it', ilikeMatches(containsPattern('100%'), '1000 Troubles'), false);
check('an underscore in a nickname search is literal', ilikeMatches(containsPattern('a_b'), 'axb'), false);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);

process.exit(failures === 0 ? 0 : 1);
