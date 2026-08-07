-- Cat Frame — profiles and player_stats
--
-- The first migration. Two tables: who a player is, and what they have earned. They are
-- separate for a reason that is mechanical rather than tidy — see the note above
-- player_stats before merging them.
--
-- Run this in the Supabase SQL editor, or with:
--   psql "$DIRECT_URL" -f migrations/2026-08-07_create_profiles.sql

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
--
-- Keyed by auth.users.id rather than carrying an id of its own. Supabase already owns
-- identity — the email, the password hash, the provider, the confirmation state — and a
-- second surrogate key would mean two ideas of "who" that can drift apart. ON DELETE
-- CASCADE so deleting the auth user removes the profile in the same transaction; a profile
-- pointing at a deleted user is unreachable garbage that still holds a username hostage.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Chosen at signup, and the only name anyone else is guaranteed to see.
  --
  -- Length and character set are enforced here rather than only in zod: the API will not
  -- be the only thing that ever writes to this table.
  username text not null,

  -- Real names, and deliberately unconstrained beyond a length cap.
  --
  -- No charset check. Names contain apostrophes, hyphens, spaces, accents and scripts
  -- that are not Latin at all, and every regex written to "validate a name" ends up
  -- rejecting real people. Nullable because email signup does not ask for them — a social
  -- login fills them from the provider, and the setup screen can ask later.
  firstname text,
  lastname text,

  -- An avatar identity like `catframe://avatar/tabby-03`, not a file URL. Nullable because
  -- the account exists before the setup screen runs — that gap is exactly what the
  -- client's `needsSetup` branch keys off.
  avatar_url text,

  -- Purchased, not earned. Written only by the receipt-validation path, which is why it
  -- sits here rather than in player_stats: it is a fact about the account, not a score.
  -- It is still unwritable from the app, because the update policy below names its columns.
  pro_subscription_active boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_length check (char_length(username) between 3 and 20),

  -- Letters, digits, underscore. No spaces, and nothing that could be dressed up to look
  -- like another player's name in a leaderboard row.
  constraint profiles_username_charset check (username ~ '^[A-Za-z0-9_]+$'),

  constraint profiles_firstname_length check (firstname is null or char_length(firstname) <= 50),
  constraint profiles_lastname_length check (lastname is null or char_length(lastname) <= 50)
);

-- Case-insensitive uniqueness. "Mochi" and "mochi" are the same person to anyone reading a
-- leaderboard, so they must not be two accounts.
create unique index profiles_username_unique_idx on public.profiles (lower(username));

comment on table public.profiles is
  'Player-owned identity. Anything earned lives in player_stats, which the client cannot write.';

-- ---------------------------------------------------------------------------
-- player_stats
-- ---------------------------------------------------------------------------
--
-- Split from profiles deliberately, and this is the load-bearing decision in this file.
--
-- Rank, xp, best score and likes are *earned*. If they sat on profiles, the same row a
-- player must be able to update — to change their username — would also carry the number
-- that decides where they sit on the leaderboard. Row level security policies apply to
-- rows; a single update policy on a combined table would make every column on it writable
-- by whoever owns the row.
--
-- Separated, this table simply has no update policy at all. A client holding the anon key
-- and a valid session cannot change a value in it no matter what it sends. That is "you
-- may rename yourself, you may not promote yourself" enforced by the database instead of
-- by an API remembering to be careful.

create table public.player_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Photographer Rank and its progress. Rank is derived from xp by the game rules; it is
  -- stored rather than recomputed so a leaderboard query does not replay the ramp for
  -- every row, and the server is responsible for keeping the two consistent.
  rank integer not null default 1,
  xp integer not null default 0,

  -- The highest single-photo score this player has ever reached — the figure the
  -- leaderboard ranks on.
  --
  -- Floor only, no ceiling. constants/game.ts states outright that the composite total has
  -- no upper bound and that a score above 100 is expected rather than a bug, so a
  -- `<= 100` check here would eventually reject a player's best shot.
  best_score integer not null default 0,

  -- Reactions received across every photo. The dominant term in rank.
  likes_received integer not null default 0,

  updated_at timestamptz not null default now(),

  -- Nothing earned may go negative. A decrement bug should fail loudly at the write rather
  -- than quietly leave somebody on -400 xp.
  constraint player_stats_rank_positive check (rank >= 1),
  constraint player_stats_xp_nonnegative check (xp >= 0),
  constraint player_stats_best_score_nonnegative check (best_score >= 0),
  constraint player_stats_likes_nonnegative check (likes_received >= 0)
);

comment on table public.player_stats is
  'Earned progression. Readable by anyone signed in; writable only through the service role.';

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------
--
-- In a trigger rather than in the API, because "whenever this row changes" is a property
-- of the row, not of whichever code path happens to change it today.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger player_stats_set_updated_at
  before update on public.player_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- A user and their rows are created together, or not at all
-- ---------------------------------------------------------------------------
--
-- Supabase writes auth.users itself when someone signs up, so the API never sees that
-- moment and cannot reliably follow it with an insert: a crash between the two leaves an
-- account that can sign in but has no profile, and every screen then has to handle a user
-- who does not exist. A trigger on auth.users runs inside the signup transaction, so all
-- rows appear together or the signup fails.
--
-- SECURITY DEFINER because the trigger runs as the authenticating role, which has no
-- rights on these tables. search_path is pinned: a SECURITY DEFINER function that resolves
-- names through the caller's search_path is the classic Postgres privilege-escalation bug.
--
-- Names and username come from the signup metadata when the client supplied them. A social
-- provider gives given_name / family_name; email signup gives whatever the form collected.
-- Username falls back to a placeholder rather than null, because a null username is a row
-- that violates its own constraint the moment anything reads it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_username text;
begin
  requested_username := nullif(trim(meta ->> 'username'), '');

  insert into public.profiles (id, username, firstname, lastname, avatar_url)
  values (
    new.id,
    coalesce(requested_username, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8)),
    nullif(trim(coalesce(meta ->> 'firstname', meta ->> 'given_name')), ''),
    nullif(trim(coalesce(meta ->> 'lastname', meta ->> 'family_name')), ''),
    nullif(trim(coalesce(meta ->> 'avatar_url', meta ->> 'picture')), '')
  );

  insert into public.player_stats (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Enabled on both tables. With RLS on and no policy granting an action, that action is
-- denied — so anything not written below is a "no" by default. The service-role key the
-- server holds bypasses all of this by design; these policies constrain the anon key that
-- ships inside the app.

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;

-- Profiles are visible to signed-in players. The community feed, the leaderboard and
-- public profiles all need somebody else's name and avatar, and nothing private lives on
-- this table — the email is in auth.users, which is not exposed.
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

-- You may edit yourself and nobody else. `with check` as well as `using`, or a player
-- could pass the check on their own row and then rewrite its id to somebody else's.
--
-- Note this grants the whole row, including pro_subscription_active. RLS cannot restrict
-- an update to particular columns; a column grant would, and it is worth adding the day
-- purchases exist. Until then the API is the only writer and it does not accept that field.
create policy "players can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No insert policy: rows are created by the signup trigger. No delete policy: deleting an
-- account goes through auth.users, and the cascade takes the profile with it.

-- Stats are readable so a profile screen can show somebody's rank. There is no insert,
-- update or delete policy at all, which is what makes them unwritable from the app.
create policy "stats are readable by signed-in users"
  on public.player_stats for select
  to authenticated
  using (true);
