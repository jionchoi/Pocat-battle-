-- Cat Frame — friendships, account settings, and a privilege-escalation fix
--
-- Run in the Supabase SQL editor, after 2026-08-12_challenges.sql.
--
-- ===========================================================================
-- READ THIS FIRST: the first block is a live security fix, not a feature
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Column grants on profiles
-- ---------------------------------------------------------------------------
--
-- **Any player can currently give themselves Pro.**
--
-- `players can update their own profile` grants the whole row, and RLS cannot restrict an
-- update to particular columns. The comment on that policy says "the API is the only writer
-- and it does not accept that field" — and that is not true: `src/lib/profile.ts`
-- (`saveOnboarding`) writes this table straight from the client, under that policy, by design.
-- So one PostgREST call from inside the app sets `pro_subscription_active = true`, which is
-- unlimited reveals and an unlimited album.
--
-- The fix is the one §2 already describes for `photos` and `cat_dex_entries`: a column grant
-- alongside the policy. Postgres checks both and the narrower wins.
--
-- Only the four fields the setup screen actually writes are granted. Push tokens, home
-- location and notification preferences are added below and are deliberately **not** in this
-- list — they go through the API, so there is no reason for the app to hold write access to
-- them.

revoke update on public.profiles from authenticated;
grant update (username, firstname, lastname, avatar_url)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Account settings on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- Where the player lives, roughly, for the map's auto-suppression and the neighbourhood
  -- leaderboard. Never published — a home address is the single most sensitive value in the
  -- schema, and nothing serializes these columns to anybody, including their owner's friends.
  add column if not exists home_lat double precision,
  add column if not exists home_lng double precision,

  -- Expo push token. Written only through PUT /auth/push-token.
  add column if not exists push_token text,

  -- Notification preferences, mirroring the client's `NotificationPreferences`.
  --
  -- Defaults chosen to match what the onboarding carousel already tells a player will happen,
  -- so the settings screen agrees with the promise on first open rather than contradicting it.
  add column if not exists share_captures_by_default boolean not null default true,
  add column if not exists push_challenge_results boolean not null default true,
  add column if not exists push_votes boolean not null default true,
  add column if not exists push_nearby_rare_cats boolean not null default false;

alter table public.profiles
  add constraint profiles_home_lat_range
    check (home_lat is null or home_lat between -90 and 90),
  add constraint profiles_home_lng_range
    check (home_lng is null or home_lng between -180 and 180),
  -- Both or neither. A latitude with no longitude is not a place, and a half-set home would
  -- silently disable the suppression it was set to enable.
  add constraint profiles_home_location_paired
    check ((home_lat is null) = (home_lng is null));

comment on column public.profiles.home_lat is
  'Never serialized to anyone, including the owner. For map suppression and neighbourhood scope only.';

-- ---------------------------------------------------------------------------
-- 3. friendships
-- ---------------------------------------------------------------------------
--
-- One row per pair, not two. A friendship is symmetric once accepted, and storing both
-- directions means two rows that can disagree — one accepted, one pending — with nothing to
-- say which is right.
--
-- The direction is still recorded, because it matters before acceptance: `requester_id` asked
-- and `addressee_id` is the only one who may answer. After acceptance the direction is
-- vestigial and every read treats the pair as unordered.

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),

  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,

  status text not null default 'pending',

  created_at timestamptz not null default now(),
  responded_at timestamptz,

  constraint friendships_status_known check (status in ('pending', 'accepted')),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

-- One friendship per pair, whichever way round it was asked.
--
-- A plain `unique (requester_id, addressee_id)` would let A→B and B→A both exist, which is two
-- pending requests between the same two people and an accept on each producing two "friends"
-- rows. Ordering the pair inside the index is what makes the constraint symmetric.
create unique index if not exists friendships_pair_unique_idx
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

create index if not exists friendships_requester_idx on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);

comment on table public.friendships is
  'One row per pair. Direction matters only until it is accepted.';

-- Declined requests are deleted rather than stored as a status.
--
-- A 'declined' row would block the pair's unique index forever, so the same two people could
-- never be friends afterwards — and it would be a permanent record of a refusal, which is not
-- a thing worth keeping about anybody.

alter table public.friendships enable row level security;

-- Readable when you are one of the two. Not writable at all: accepting a request changes who
-- can see whose feed, so it goes through the API for the reason §2 gives about anything that
-- decides visibility.
create policy "Friendships are readable by the people in them"
  on public.friendships for select
  to authenticated
  using (
    (select auth.uid()) = requester_id or (select auth.uid()) = addressee_id
  );
