-- Username search.
--
-- `username ILIKE '%mochi%'` cannot use a B-tree: the leading wildcard means there is no
-- prefix to seek to, so Postgres reads every row in "User" and lowercases it. That is a
-- full table scan on a path the client hits while someone is still typing.
--
-- A GIN index over trigrams indexes every three-character run in the string, which is
-- exactly what an unanchored ILIKE needs. Cost is one index and a write-time trigram
-- decomposition per username -- usernames are written approximately never and searched
-- constantly.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "User_username_trgm_idx"
  ON "User" USING gin (lower("username") gin_trgm_ops);

-- The same problem, one scale down: album search matches a cat's nickname with an
-- unanchored ILIKE. It is filtered by owner first so it never scans the whole table, but
-- a Pro player with thousands of photos still pays a scan of their own rows.
CREATE INDEX IF NOT EXISTS "Cat_defaultNickname_trgm_idx"
  ON "Cat" USING gin (lower("defaultNickname") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "CatDexEntry_nickname_trgm_idx"
  ON "CatDexEntry" USING gin (lower("nickname") gin_trgm_ops);

-- Map viewport queries.
--
-- `lat BETWEEN ... AND lng BETWEEN ...` against two separate single-column B-trees makes
-- Postgres pick one, scan every row in that latitude band, and filter the rest by hand. In
-- a dense city that band is most of the table.
--
-- A GiST index over the point handles both dimensions at once, so a viewport is one
-- bounding-box lookup. Sightings expire, so this index stays small.
CREATE INDEX IF NOT EXISTS "CatSighting_point_idx"
  ON "CatSighting" USING gist (point("lng", "lat"));
