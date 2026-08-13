import { supabase } from '../lib/supabase.js';
import { containsPattern } from '../lib/search.js';

/**
 * What this player calls each of their cats.
 *
 * A photo row carries a `cat_id` and nothing else, but the client's `Photo` carries
 * `catNickname` — denormalised on purpose so a grid of thirty photos does not fetch thirty
 * cats. Something has to do that lookup, and doing it per photo is exactly the N+1 the
 * denormalisation exists to avoid. So it happens once per page, here.
 *
 * The name itself is two-layered: `cat_dex_entries.nickname` is what *this* player decided
 * to call the animal, and `cats.default_nickname` is what it was called when it was first
 * discovered — by anyone. The player's own name wins wherever they set one.
 */

/** Empty string rather than null, because that is what the client's `Photo.catNickname` is. */
export type NicknameMap = Map<string, string>;

/**
 * Nicknames for a set of cats, in one query.
 *
 * Returns a map missing any cat the player has no dex entry for. That is a real state and
 * not an error: a photo can be attached to a cat another player discovered before this one
 * has confirmed their own encounter with it.
 */
export async function nicknamesFor(
  userId: string,
  catIds: readonly string[]
): Promise<NicknameMap> {
  const unique = [...new Set(catIds)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from('cat_dex_entries')
    .select('cat_id, nickname, cats ( default_nickname )')
    .eq('user_id', userId)
    .in('cat_id', unique);

  if (error) throw error;

  const map: NicknameMap = new Map();

  for (const row of data ?? []) {
    // PostgREST types a to-one embed as an array when it cannot prove the cardinality;
    // normalising here keeps that quirk out of the caller.
    const cat = row.cats as { default_nickname: string } | { default_nickname: string }[] | null;
    const fallback = (Array.isArray(cat) ? cat[0] : cat)?.default_nickname ?? '';

    map.set(row.cat_id as string, (row.nickname as string | null) ?? fallback);
  }

  return map;
}

/**
 * The cats whose name matches a search box, for the album's filter.
 *
 * The album searches by what the player calls the cat, which is the one thing about a photo
 * that is not on the photo's row — so the filter cannot be a `WHERE` on `photos`. It is
 * resolved to a list of cat ids first, and the album query then filters on `cat_id`.
 *
 * Two fetches rather than an embedded filter because the name has a fallback: PostgREST can
 * `ilike` on an embedded column, but it cannot express "the player's nickname, or the cat's
 * default when they have not set one", and searching only the nickname would silently fail
 * to find every cat the player never renamed.
 *
 * An empty result means "matched nothing", which is different from "no filter" — the caller
 * has to return an empty page rather than the whole album.
 */
export async function catIdsMatchingNickname(
  userId: string,
  search: string
): Promise<string[]> {
  const term = search.trim();
  if (term === '') return [];

  // A contains-match, escaped so a player typing `%` or `_` means the character. See
  // lib/search.ts for why the escape is shared and the wildcards are not.
  const pattern = containsPattern(term);

  const [byNickname, byDefault] = await Promise.all([
    supabase
      .from('cat_dex_entries')
      .select('cat_id')
      .eq('user_id', userId)
      .ilike('nickname', pattern),

    // Only cats this player has an entry for, so the search cannot surface the existence of
    // a cat they have never photographed. `!inner` makes the embed a join rather than a
    // nullable attachment, which is what turns it into a filter.
    supabase
      .from('cat_dex_entries')
      .select('cat_id, cats!inner ( default_nickname )')
      .eq('user_id', userId)
      .is('nickname', null)
      .ilike('cats.default_nickname', pattern),
  ]);

  if (byNickname.error) throw byNickname.error;
  if (byDefault.error) throw byDefault.error;

  return [
    ...new Set([
      ...(byNickname.data ?? []).map((row) => row.cat_id as string),
      ...(byDefault.data ?? []).map((row) => row.cat_id as string),
    ]),
  ];
}
