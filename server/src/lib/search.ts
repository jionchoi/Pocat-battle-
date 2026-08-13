/**
 * Turning something a player typed into something `ilike` can be given safely.
 *
 * ## Why this is a file rather than a line
 *
 * `%` and `_` are wildcards in SQL `LIKE`, and `_` in particular is a legal character in a
 * username — `profiles_username_charset` permits `[A-Za-z0-9_]`. So a search term pasted
 * straight into an `ilike` is a pattern the player did not know they were writing: `mo_hi`
 * matches `mochi`, and `%` matches everything.
 *
 * Three places build `ilike` patterns and each wants a different shape — `%term%` for the
 * album's cat-name filter, `term%` for user search, and a bare term for looking somebody up by
 * name exactly. That difference is why the escaping was written out by hand three times, and
 * why one of the three was missing it: `services/friends.ts` passed the raw name, so adding
 * `mo_hi` as a friend sent the request to whoever matched `mochi` instead, and a term matching
 * two accounts turned `.maybeSingle()` into a 500.
 *
 * So the escape lives here once and the wildcards stay at the call sites. A site adding its own
 * `%` is stating intent; a site forgetting to escape is now not possible without going out of
 * its way.
 */

/**
 * Escapes the LIKE metacharacters in a term, adding no wildcards of its own.
 *
 * Backslash is Postgres' default escape character, so `\%` and `\_` match the literal
 * characters and `\\` matches a literal backslash — which has to be escaped first, or escaping
 * the other two would produce backslashes that then get read as escapes themselves.
 *
 * The result is a pattern that matches the term and nothing else. Wrap it in `%` at the call
 * site if a contains-match is what is wanted.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * A prefix match: everything starting with this term.
 *
 * Prefix-anchored rather than contains, and for user search that is a privacy decision rather
 * than an index one — `%oe%` lets somebody enumerate the user table a couple of letters at a
 * time, where `oe%` only answers people looking for a name they already partly know.
 */
export function prefixPattern(term: string): string {
  return `${escapeLike(term)}%`;
}

/** A contains match: the term anywhere in the value. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}
