-- Cat Frame — cats, dex entries and photos
--
-- The capture loop's tables. Three of them, and the shape follows one decision: a photo
-- exists the moment the shutter fires, and everything else about it arrives later and
-- separately. It may have no score yet, and it may not be attached to a cat yet.
--
-- What is deliberately NOT here: votes, community score, view counts, featured, and the
-- challenge link. Those belong to the feed and challenge migrations, and adding columns now
-- for screens that do not exist is how the last schema ended up carrying fields nothing
-- read.
--
-- Run in the Supabase SQL editor, or:
--   psql "$DIRECT_URL" -f migrations/2026-08-07_create_photos_and_cats.sql

-- ---------------------------------------------------------------------------
-- Shared vocabulary
-- ---------------------------------------------------------------------------
--
-- Text plus a check constraint, not a Postgres enum. Adding a pose to an enum is an ALTER
-- TYPE that has to be coordinated with a deploy; swapping a check constraint is one
-- statement. The client's unions in src/models/index.ts are the source of truth for both.

create domain public.rarity as text
  check (value in ('Common', 'Rare', 'Epic', 'Legendary'));

create domain public.pose_class as text
  check (value in (
    'sitting', 'standing', 'walking', 'sleeping', 'grooming', 'stretching',
    'yawning', 'jumping', 'pouncing', 'loafing', 'unknown'
  ));

-- ---------------------------------------------------------------------------
-- cats
-- ---------------------------------------------------------------------------
--
-- One row per real animal, shared by everyone who photographs it. What a *player* calls it
-- and how often they have seen it lives in cat_dex_entries — this table is the cat, not
-- anybody's relationship with it.

create table public.cats (
  id uuid primary key default gen_random_uuid(),

  -- Whoever photographed it first. Nullable and ON DELETE SET NULL: deleting an account
  -- must not delete a cat that is sitting in other players' dexes. The privacy screen
  -- already promises exactly this.
  discovered_by uuid references public.profiles (id) on delete set null,

  -- The fallback name, used until a player sets their own nickname on their dex entry.
  default_nickname text not null,

  -- How rare this cat is, which is one of the four components of a photo's score.
  rarity public.rarity not null default 'Common',

  -- ## Identity traits
  --
  -- Extracted by the same vision call that scores the photo, and the reason it is one call.
  -- These are what shortlist candidates when the next photo is taken nearby; the player
  -- makes the final call, so these only have to be good enough to rank a handful of cats,
  -- not good enough to decide on their own.
  coat_pattern text,
  primary_color text,
  secondary_color text,
  eye_color text,
  markings text[] not null default '{}',

  -- Where it was first seen, and where it was last seen. Cats are territorial, which makes
  -- proximity the strongest matching signal available and it costs nothing.
  first_seen_lat double precision not null,
  first_seen_lng double precision not null,
  last_seen_lat double precision not null,
  last_seen_lng double precision not null,
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);

-- Bounding-box lookups for the matching shortlist. Two plain columns and a btree are enough
-- to ask "cats last seen within a few hundred metres"; PostGIS earns its keep when the map
-- needs true radius queries and ordering by distance, and can be added without touching
-- these columns.
create index cats_last_seen_idx on public.cats (last_seen_lat, last_seen_lng);
create index cats_traits_idx on public.cats (coat_pattern, primary_color);

comment on table public.cats is
  'One row per real animal, shared across players. Nicknames live on cat_dex_entries.';

-- ---------------------------------------------------------------------------
-- cat_dex_entries
-- ---------------------------------------------------------------------------
--
-- One player's relationship with one cat: what they call it, how often they have seen it,
-- and which of their photos represents it.

create table public.cat_dex_entries (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,
  cat_id uuid not null references public.cats (id) on delete cascade,

  -- Player-editable. Null falls back to cats.default_nickname.
  nickname text,
  bio text,

  -- The photo on this cat's card. Set by score by default; `best_photo_pinned` is the
  -- player overriding that by hand, and while it is true a higher score no longer moves it.
  --
  -- ON DELETE SET NULL rather than cascade: deleting the best photo must not delete the
  -- player's whole relationship with the cat. The service promotes the next-best.
  best_photo_id uuid,
  best_photo_score integer not null default 0,
  best_tier public.rarity not null default 'Common',
  best_photo_pinned boolean not null default false,

  encounter_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cat_dex_entries_unique unique (user_id, cat_id),
  constraint cat_dex_entries_nickname_length
    check (nickname is null or char_length(nickname) between 1 and 30),
  constraint cat_dex_entries_bio_length check (bio is null or char_length(bio) <= 200),
  constraint cat_dex_entries_encounters_positive check (encounter_count >= 1)
);

create index cat_dex_entries_user_idx on public.cat_dex_entries (user_id, last_seen_at desc);
create index cat_dex_entries_cat_idx on public.cat_dex_entries (cat_id);

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------
--
-- ## A photo is created unscored and unattached
--
-- Both of those are nullable states with a timestamp beside them, and both are the product
-- working as designed rather than a gap to fill in later:
--
--   scored_at    null  — the shutter is free and unlimited. Scoring is the rationed part,
--                        so a capture beyond today's allowance is saved whole and its score
--                        revealed from the album when the player has one to spend.
--
--   cat_id       null  — matching shortlists candidates from location and traits, and the
--                        player confirms. Until they do, the photo is of a cat we have not
--                        named yet, which is the truth and should be stored as the truth.

create table public.photos (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.profiles (id) on delete cascade,

  -- The object in the storage bucket, e.g. `<owner_id>/<uuid>.jpg`. A path, not a URL:
  -- the bucket, the CDN host and the signing scheme are all deployment details, and a URL
  -- baked into a row is a row that breaks when any of them changes.
  storage_path text not null,

  caption text,

  captured_at timestamptz not null default now(),
  captured_lat double precision not null,
  captured_lng double precision not null,

  -- ## Identity
  --
  -- Attached when the player confirms a match. `identified_at` says when, which is what
  -- lets the album show "not yet identified" without inferring it from a null join.
  cat_id uuid references public.cats (id) on delete set null,
  identified_at timestamptz,

  -- What the vision call saw in this specific photo. Promoted onto the cat when the player
  -- confirms a new one, kept here regardless so a later matching pass can reconsider
  -- without paying for the image again.
  traits jsonb not null default '{}'::jsonb,

  -- ## Score
  --
  -- All null together, or all set together — see the constraint at the bottom. A photo with
  -- a total and no components would render a breakdown of blanks.
  score_composition integer,
  score_pose_rarity integer,
  score_cat_rarity integer,
  score_bonus integer,
  score_total integer,
  tier public.rarity,
  pose public.pose_class,
  badges text[] not null default '{}',

  -- When the score was revealed. Null means unscored, and counting these over the last
  -- 24 hours is the entire quota mechanism — no separate ledger table, because a table
  -- would be a second copy of a fact these rows already carry.
  scored_at timestamptz,

  -- ## How it was judged
  --
  -- A score ranks a leaderboard, so which model and prompt produced it is part of the
  -- record. Change either and you need to know which photos were judged on which scale;
  -- without this the board silently mixes two of them.
  scoring_model text,
  scoring_version text,
  scoring_raw jsonb,

  -- Owner-controlled visibility. The feed migration adds what the community does with it.
  shared_to_feed boolean not null default false,
  showcased boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint photos_caption_length check (caption is null or char_length(caption) <= 140),

  -- No ceiling on the total. constants/game.ts states that a score above 100 is expected
  -- and forbids reintroducing a cap, so only the floor is checked.
  constraint photos_score_nonnegative check (
    coalesce(score_composition, 0) >= 0
    and coalesce(score_pose_rarity, 0) >= 0
    and coalesce(score_cat_rarity, 0) >= 0
    and coalesce(score_total, 0) >= 0
  ),

  -- Scored means scored. Every field arrives in one write or none of them do, so there is
  -- no such thing as a half-scored photo for a screen to have to handle.
  constraint photos_scored_together check (
    (scored_at is null
      and score_composition is null and score_pose_rarity is null
      and score_cat_rarity is null and score_bonus is null
      and score_total is null and tier is null and pose is null
      and scoring_model is null)
    or
    (scored_at is not null
      and score_composition is not null and score_pose_rarity is not null
      and score_cat_rarity is not null and score_bonus is not null
      and score_total is not null and tier is not null and pose is not null
      and scoring_model is not null)
  ),

  -- Identified means attached. The timestamp and the link move together.
  constraint photos_identified_together check (
    (cat_id is null and identified_at is null)
    or (cat_id is not null and identified_at is not null)
  )
);

-- The album, newest first.
create index photos_owner_idx on public.photos (owner_id, captured_at desc);
-- The leaderboard's "best photo", and the dex entry's best-shot promotion.
create index photos_owner_score_idx on public.photos (owner_id, score_total desc);
-- Every photo of one cat, for the cat profile.
create index photos_cat_idx on public.photos (cat_id, captured_at desc);
-- Counting today's reveals, which happens on every capture.
create index photos_quota_idx on public.photos (owner_id, scored_at desc)
  where scored_at is not null;
-- The map's sighting pins.
create index photos_location_idx on public.photos (captured_lat, captured_lng);

comment on column public.photos.scored_at is
  'Null until the score is revealed. Reveals in the last 24h are the rationing mechanism.';

-- Deferred until now because photos did not exist when cat_dex_entries was created.
alter table public.cat_dex_entries
  add constraint cat_dex_entries_best_photo_fkey
  foreign key (best_photo_id) references public.photos (id) on delete set null;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
--
-- Reusing the function the profiles migration created.

create trigger cat_dex_entries_set_updated_at
  before update on public.cat_dex_entries
  for each row execute function public.set_updated_at();

create trigger photos_set_updated_at
  before update on public.photos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- On everywhere, denying by default. The server's service-role key bypasses all of it; these
-- policies constrain the anon key in the app.
--
-- The pattern throughout: the app may READ what belongs to it and may EDIT only the fields
-- a player owns. Nothing here grants an insert, because every row in these tables is created
-- by the capture pipeline — a client that could insert a photo could insert its own score.

alter table public.cats enable row level security;
alter table public.cat_dex_entries enable row level security;
alter table public.photos enable row level security;

-- Cats are shared. Any signed-in player may read one, which is what makes another player's
-- dex and the map's pins renderable.
create policy "cats are readable by signed-in users"
  on public.cats for select
  to authenticated
  using (true);

-- A dex entry is personal. You see your own, and you may rename your own cats.
create policy "players read their own dex"
  on public.cat_dex_entries for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "players rename their own cats"
  on public.cat_dex_entries for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Your album is yours. Photos shared to the feed become visible to others in the feed
-- migration, along with the tables that make a feed possible.
create policy "players read their own photos"
  on public.photos for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Caption, sharing and showcasing are the player's to change. The score is not — but RLS
-- grants rows, not columns, so this policy does technically expose score_total to an
-- update from the app.
--
-- That is a real hole and it is closed one layer down, with a column grant: revoke update
-- on the whole table from `authenticated`, then grant it back on exactly the three columns
-- a player owns. Postgres checks both, so the narrower one wins.
create policy "players edit their own photos"
  on public.photos for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke update on public.photos from authenticated;
grant update (caption, shared_to_feed, showcased) on public.photos to authenticated;

-- Same treatment for the dex: rename and pin, nothing else.
revoke update on public.cat_dex_entries from authenticated;
grant update (nickname, bio, best_photo_id, best_photo_pinned)
  on public.cat_dex_entries to authenticated;
