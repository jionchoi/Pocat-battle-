-- Cat Frame — profiles
--
-- The first table. It answers one question: who is this person, as they chose to present
-- themselves. Everything a player *earns* lives elsewhere, for the reason set out below.
--
-- Run this in the Supabase SQL editor, or with:
--   psql "$DIRECT_URL" -f migrations/2026-08-07_create_profiles.sql

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
--
-- Keyed by auth.users.id rather than carrying an id of its own. Supabase already owns
-- identity — the email, the password hash, the provider, the confirmation state — and a
-- second surrogate key would mean two ideas of "who" that can drift apart. The foreign key
-- is ON DELETE CASCADE so deleting the auth user removes the profile in the same
-- transaction; a profile row pointing at a deleted user is unreachable garbage that still
-- holds a username hostage.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Chosen at signup, and the only name anyone else ever sees.
  --
  -- citext would make uniqueness case-insensitive without the lower() index below, but it
  -- is an extension, and an extension is a dependency for something a unique index does
  -- perfectly well. Length and character set are enforced here rather than only in zod:
  -- the API is not the only thing that will ever write to this table.
  username text not null,

  -- An avatar identity like `catframe://avatar/tabby-03`, not a file URL. Nullable because
  -- the account exists before the setup screen has run — that gap is exactly what the
  -- client's `needsSetup` branch keys off.
  avatar_url text,

  -- Purchased, not earned, and written only by the receipt-validation path.
  pro_subscription_active boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_length check (char_length(username) between 3 and 20),

  -- Letters, digits, underscore. No spaces, no punctuation that reads differently in
  -- another font, nothing that could be confused with another player's name.
  constraint profiles_username_charset check (username ~ '^[A-Za-z0-9_]+$')
);

-- Case-insensitive uniqueness. "Mochi" and "mochi" are the same person to a human reading
-- a leaderboard, so they must not be two accounts.
create unique index profiles_username_unique_idx on public.profiles (lower(username));

comment on table public.profiles is
  'Player-owned identity. Anything earned lives in player_stats, which the client cannot write.';

-- ---------------------------------------------------------------------------
-- player_stats
-- ---------------------------------------------------------------------------
--
-- Split from profiles deliberately, and this is the load-bearing decision in this file.
--
-- Rank, XP and reactions received are *earned*. If they sat on profiles, then the same row
-- a player must be able to update — to change their username — would also carry the number
-- that decides where they sit on the leaderboard. Postgres grants privileges per column,
-- but row level security policies are per row: one writable policy on profiles would make
-- every column on it writable. The only way to say "you may rename yourself, you may not
-- promote yourself" without relying on the API to be careful is to put them in different
-- tables.
--
-- So: profiles is written by the player, player_stats is written only by the server. No
-- update policy is granted here at all, which means a client holding the anon key and a
-- valid session cannot alter a single value in it no matter what it sends.

create table public.player_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Photographer Rank and its progress. Rank is derived from xp by the game rules; it is
  -- stored rather than computed so a leaderboard query does not have to replay the ramp
  -- for every row, and the server is responsible for keeping the two consistent.
  photographer_rank integer not null default 1,
  photographer_xp integer not null default 0,

  -- The app's own opinion of your work, summed across every photo. Shown for interest and
  -- deliberately not what rank is computed from — see the Me model in the client.
  lifetime_score integer not null default 0,

  -- Reactions received across every photo. The dominant term in rank.
  votes_received integer not null default 0,

  updated_at timestamptz not null default now(),

  -- Nothing earned can go negative. A bug that decrements too far should fail loudly at
  -- the write rather than quietly leave a player on -400 XP.
  constraint player_stats_rank_positive check (photographer_rank >= 1),
  constraint player_stats_xp_nonnegative check (photographer_xp >= 0),
  constraint player_stats_score_nonnegative check (lifetime_score >= 0),
  constraint player_stats_votes_nonnegative check (votes_received >= 0)
);

comment on table public.player_stats is
  'Earned progression. Readable by anyone signed in; writable only through the service role.';

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------
--
-- In a trigger rather than in the API, because "whenever this row changes" is a property
-- of the row, not of the one code path that happens to change it today.

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
-- who does not exist. A trigger on auth.users runs inside the same transaction as the
-- signup, so the three rows appear together or the signup fails.
--
-- SECURITY DEFINER because the trigger runs as the authenticating role, which has no
-- rights on these tables. search_path is pinned: a SECURITY DEFINER function that resolves
-- names through the caller's search_path is the classic Postgres privilege-escalation bug.
--
-- The username comes from the signup metadata when the client supplied one, and otherwise
-- from a placeholder the setup screen replaces. It is never left null, because a null
-- username is a row that violates its own constraint the moment anyone reads it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
begin
  requested_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(requested_username, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8))
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
-- denied — so the default for anything not written below is "no". The service-role key the
-- server holds bypasses all of this by design; these policies exist to constrain the anon
-- key that ships inside the app.

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;

-- Profiles are public to signed-in players. The community feed, the leaderboard and public
-- profiles all need to show somebody else's name and avatar, and there is nothing private
-- on this table — the email lives in auth.users, which is not exposed.
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

-- You may edit yourself and nobody else. `with check` as well as `using`, or a player
-- could pass the row check on their own row and then rewrite its id to somebody else's.
create policy "players can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No insert policy, and that is deliberate: rows are created by the signup trigger. No
-- delete policy either — deleting an account goes through auth.users, and the cascade
-- takes the profile with it.

-- Stats are readable so a profile screen can show somebody's rank. There is no insert,
-- update or delete policy at all, which is what makes them unwritable from the app.
create policy "stats are readable by signed-in users"
  on public.player_stats for select
  to authenticated
  using (true);
