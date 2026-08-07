-- Move an already-applied database to "username is chosen at onboarding".
--
-- Run this ONLY if you applied an earlier copy of 2026-08-07_create_profiles.sql. The
-- create script as it stands today already matches this state.
--
-- ## What was wrong
--
-- The first version of that script declared `username text not null` and had the signup
-- trigger invent a placeholder — `player_` plus eight hex characters — so the column could
-- be satisfied at the moment an account was created.
--
-- That placeholder defeats the setup gate. The client sends a player to onboarding when
-- their profile has no username, and a generated name is a username: it passes the check,
-- so an account that has never chosen a name walks straight into the app wearing one.
--
-- Editing the .sql file changed nothing here. A function lives in the database once it has
-- been created, so the old one keeps running until it is replaced.
--
-- Every statement below is safe to run twice.

begin;

-- ---------------------------------------------------------------------------
-- 1. The column may be empty until onboarding fills it
-- ---------------------------------------------------------------------------

alter table public.profiles alter column username drop not null;

-- Both checks have to pass on null now. Dropping first because a check constraint cannot
-- be altered in place.
alter table public.profiles drop constraint if exists profiles_username_length;
alter table public.profiles drop constraint if exists profiles_username_charset;

alter table public.profiles
  add constraint profiles_username_length
    check (username is null or char_length(username) between 3 and 20);

alter table public.profiles
  add constraint profiles_username_charset
    check (username is null or username ~ '^[A-Za-z0-9_]+$');

-- ---------------------------------------------------------------------------
-- 2. Stop generating names at signup
-- ---------------------------------------------------------------------------
--
-- Same body as the create script's, carried here so a database that ran the old one ends
-- up with the current function rather than a near-copy of it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, firstname, lastname, avatar_url)
  values (
    new.id,
    nullif(trim(coalesce(meta ->> 'firstname', meta ->> 'given_name')), ''),
    nullif(trim(coalesce(meta ->> 'lastname', meta ->> 'family_name')), ''),
    nullif(trim(coalesce(meta ->> 'avatar_url', meta ->> 'picture')), '')
  );

  insert into public.player_stats (user_id)
  values (new.id);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Clear the names that were generated, not chosen
-- ---------------------------------------------------------------------------
--
-- This edits existing rows, so read it before running it.
--
-- The pattern matches exactly what the old trigger produced: `player_` followed by eight
-- lowercase hex characters, anchored at both ends. A name a player typed cannot match it
-- unless they deliberately typed a uuid fragment, and the case anchor rules out `Player_`.
--
-- Nulling these is what sends those accounts back to onboarding, which is where they
-- should have gone in the first place. Nothing else about them changes.
--
-- If you would rather delete the test accounts outright, do that in Authentication → Users
-- instead; the cascade takes the profile and the stats with them.

update public.profiles
set username = null
where username ~ '^player_[0-9a-f]{8}$';

commit;

-- Confirm:
--
--   select id, username from public.profiles;
--
-- Expect null for every account that never reached the setup screen. Reload the app and it
-- should open on the avatar and name step.
