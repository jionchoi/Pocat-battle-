-- Cat Frame — per-photo control over the map pin
--
-- The third thing a player owns on their own photograph, beside the caption and the feed.
-- It exists now, before /map/sightings does, for one reason: the default applies to every
-- row already in the table, and consent cannot be collected retroactively for coordinates
-- that were stored under a different promise. Deciding it after the map ships means
-- deciding it for photographs whose owners were never asked.
--
-- Default true, which is the promise already made. The onboarding carousel and the privacy
-- screen both tell a player that their captures put sightings on the map, so a column that
-- silently defaulted false would make the app quieter than its own copy — and an empty map
-- is not a privacy win, it is a feature nobody can find the switch for. The switch is the
-- protection, and it is one tap on the reveal screen.
--
-- What this column is NOT: the thing that keeps a location private. The row keeps exact
-- coordinates either way, because territorial proximity is what matches a cat to the one
-- the player met last week. Two separate protections carry that weight and neither lives
-- here — the map serializer coarsens every pin that is not the viewer's own, and nothing
-- but the owner is ever served the raw pair.
--
-- Run in the Supabase SQL editor, or:
--   psql "$DIRECT_URL" -f migrations/2026-08-10_photos_shared_to_map.sql

alter table public.photos
  add column shared_to_map boolean not null default true;

comment on column public.photos.shared_to_map is
  'Owner-controlled. False keeps the capture out of /map/sightings; the row keeps its exact coordinates regardless, for cat matching.';

-- ---------------------------------------------------------------------------
-- The column grant
-- ---------------------------------------------------------------------------
--
-- `update` on the whole table is already revoked from `authenticated` by the photos
-- migration, and a fresh column is not covered by the grant that names the older three.
-- So this adds one column to that grant rather than re-issuing it: granting is additive
-- per column, and re-running the revoke here would drop the existing three for as long as
-- it took the next statement to run.
--
-- Postgres checks the grant and the RLS policy independently and the narrower wins, which
-- is what keeps `score_total` unwritable by the app while these four stay editable.

grant update (shared_to_map) on public.photos to authenticated;
