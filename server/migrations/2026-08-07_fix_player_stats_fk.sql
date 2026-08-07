-- Point player_stats at profiles instead of auth.users.
--
-- Run this ONLY if you already applied 2026-08-07_create_profiles.sql. If you have not, the
-- create script is already correct and this file does nothing you need.
--
-- ## What was wrong
--
-- Both tables referenced auth.users, so there was no foreign key *between them*. PostgREST
-- embeds one table in another by following a foreign key, so the client's request for
--
--   profiles ( ..., player_stats ( rank, xp, best_score, likes_received ) )
--
-- had no key to follow and failed with PGRST200 — "could not find a relationship". The app
-- read that as an unknown failure rather than as a missing profile, and let the player
-- into the main tabs without one.
--
-- Referencing profiles is also the truer statement: stats belong to a profile, and the
-- profile is what belongs to an account. Deleting an auth user still removes both, one hop
-- further along the chain.

begin;

alter table public.player_stats
  drop constraint if exists player_stats_user_id_fkey;

alter table public.player_stats
  add constraint player_stats_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

commit;

-- Confirm the relationship now exists:
--
--   select conname, confrelid::regclass as points_at
--   from pg_constraint
--   where conrelid = 'public.player_stats'::regclass and contype = 'f';
--
-- Expect one row: player_stats_user_id_fkey -> profiles
