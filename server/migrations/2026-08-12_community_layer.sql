-- Cat Frame — the community layer
--
-- Reactions, unique views, and the smoothed engagement ratio the leaderboards actually rank
-- on. This is the second scoring layer: the model's number says what the app thinks of a
-- photograph, and community_score says what people think, and the gap between them is the
-- point rather than a discrepancy to reconcile.
--
-- Run in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- The counters, on photos
-- ---------------------------------------------------------------------------
--
-- Denormalised onto the row rather than counted at read time. A feed page is thirty photos
-- and every card draws all four of these; counting them per card is thirty aggregate queries
-- per scroll, over the two largest tables in the product.
--
-- The service is what keeps them true, in the same request that writes the vote. There is no
-- trigger, deliberately: a trigger would be a second place progression happens, and the one
-- that already exists — likes_received on player_stats — has to move in the same breath.

alter table public.photos
  -- Bayesian-smoothed engagement ratio, 0..1000. See game/community.ts for the formula and
  -- why it is smoothed rather than a raw votes/views. Scale mirrors COMMUNITY_CONFIG.scoreScale.
  add column if not exists community_score integer not null default 0,

  -- Unique viewers, not impressions. The denominator of the ratio, and the reason
  -- photo_views below exists at all.
  add column if not exists view_count integer not null default 0,

  -- Total reactions across all three kinds. The brief's shape; the per-kind tallies are
  -- counted from `votes` when a card needs them.
  add column if not exists vote_count integer not null default 0,

  -- Editorially boosted in the feed, for cold start. Nothing in the app sets this; it is a
  -- switch for a human with database access and a quiet week.
  add column if not exists featured boolean not null default false;

alter table public.photos
  add constraint photos_community_score_range
    check (community_score between 0 and 1000),
  add constraint photos_view_count_nonnegative check (view_count >= 0),
  add constraint photos_vote_count_nonnegative check (vote_count >= 0);

comment on column public.photos.community_score is
  'Smoothed engagement ratio 0..1000. What rank is computed from — not score_total.';
comment on column public.photos.view_count is
  'Unique viewers. Below COMMUNITY_CONFIG.minViewsForConfidence the ratio is provisional.';

-- The ranked feed's ordering. Without this, every viral page is a full scan of photos.
create index if not exists photos_feed_idx
  on public.photos (shared_to_feed, created_at desc)
  where shared_to_feed;

create index if not exists photos_viral_idx
  on public.photos (shared_to_feed, community_score desc, created_at desc)
  where shared_to_feed;

-- ---------------------------------------------------------------------------
-- votes
-- ---------------------------------------------------------------------------
--
-- One row per person per photograph. The unique constraint is the rule, not an optimisation:
-- changing your reaction updates the row, and there is no version of this where somebody
-- holds two opinions about one picture at once.
--
-- voter_id cascades and photo_id cascades, and this is the one place in the schema where a
-- cascade is right rather than `set null`. A vote is a relationship between two things; with
-- either end gone there is nothing left for the row to mean. Compare `reveals`, which
-- deliberately outlives its photo because it records a *spend* rather than an opinion.

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,

  reaction text not null,

  created_at timestamptz not null default now(),

  constraint votes_one_per_person unique (photo_id, voter_id),
  constraint votes_reaction_known check (reaction in ('laugh', 'love', 'wow'))
);

create index if not exists votes_photo_idx on public.votes (photo_id);
create index if not exists votes_voter_recent_idx on public.votes (voter_id, created_at desc);

comment on table public.votes is
  'One reaction per person per photo. Changing your mind updates the row.';

-- ---------------------------------------------------------------------------
-- photo_views
-- ---------------------------------------------------------------------------
--
-- What makes view_count *unique* viewers rather than a count of scroll events.
--
-- This will be the largest table in the product — it grows as readers times photographs seen,
-- which is far faster than either. That cost is accepted for one reason: the engagement ratio
-- is the denominator of everything the leaderboards rank on, and a denominator that counts the
-- same person twice is a number anyone can inflate by scrolling past their own photo.
--
-- No id column. The pair is the key, which is what the dedupe needs and is two indexes fewer.

create table if not exists public.photo_views (
  photo_id uuid not null references public.photos (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  first_seen_at timestamptz not null default now(),

  primary key (photo_id, viewer_id)
);

comment on table public.photo_views is
  'One row the first time somebody sees a photo. The denominator of the engagement ratio.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- A shared photo becomes readable by everyone signed in.
--
-- Additive to the owner policy already on this table: Postgres ORs permissive policies
-- together, so an owner keeps seeing their whole album and everyone else sees only what has
-- been shared. `shared_to_feed` is the public/private line and it is the player's own switch.
--
-- This does not expose location. `captured_lat/lng` are columns on a row a reader can now
-- select, so nothing stops PostgREST returning them — which is exactly why the feed is served
-- by our API through serializers/feedPhoto.ts and not read from Postgres by the client. The
-- map's coarsening lives in the same place and for the same reason.

drop policy if exists "Shared photos are readable by anyone signed in" on public.photos;
create policy "Shared photos are readable by anyone signed in"
  on public.photos for select
  to authenticated
  using (shared_to_feed);

alter table public.votes enable row level security;
alter table public.photo_views enable row level security;

-- Readable so a client could count reactions itself; writable only through the service role,
-- because a vote moves community_score and likes_received and those must not be app-writable.
drop policy if exists "Votes are readable by anyone signed in" on public.votes;
create policy "Votes are readable by anyone signed in"
  on public.votes for select
  to authenticated
  using (true);

-- No select policy on photo_views at all. Who has looked at a photograph is nobody's business
-- but the counter's, and a readable table here would answer "has this person seen this" for
-- anyone willing to ask.

-- ---------------------------------------------------------------------------
-- likes_received
-- ---------------------------------------------------------------------------
--
-- Already on player_stats from the first migration, and nothing has ever written it. The vote
-- service does now. No schema change needed; this comment is here so the next person looking
-- for where it comes from finds the answer in the migration that started using it.
