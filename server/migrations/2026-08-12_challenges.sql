-- Cat Frame — challenges
--
-- A prompt, a window, and one entry per player. The third thing that ranks a photograph,
-- after the model's score and the community's ratio — and unlike those two it is the only one
-- a player opts into.
--
-- Run in the Supabase SQL editor, after 2026-08-12_community_layer.sql.

-- ---------------------------------------------------------------------------
-- challenges
-- ---------------------------------------------------------------------------
--
-- Rows are authored, not generated. There is no rotation job and deliberately so: `status` is
-- derived from these two timestamps at read time, so seeding a quarter of challenges ahead is
-- an INSERT and nothing has to be running at midnight for the hub to be correct.
--
-- See services/challenges.ts for the other half of that decision — closing a challenge and
-- picking its winner happens lazily, on the first read after `ends_at`.

create table public.challenges (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  -- What the player is being asked for. Shown verbatim on the card.
  prompt text not null,

  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- How the winner is picked. Objective prompts rank on the model's score; subjective ones
  -- ("funniest") have to fall back to what people thought, because there is no rubric for funny.
  judging text not null default 'score',

  -- A closed key rather than an asset name, so the server never dictates a client image. An
  -- unrecognised value falls back to the trophy rather than rendering nothing.
  icon text,

  -- What winning pays. Zero is legal and means the reward is the trophy.
  reward_xp integer not null default 0,

  -- Both written by the lazy settlement in services/challenges.ts, together. `settled_at` is
  -- what stops a closed challenge being re-judged on every read — a winner is picked once.
  winning_photo_id uuid references public.photos (id) on delete set null,
  settled_at timestamptz,

  created_at timestamptz not null default now(),

  constraint challenges_window_ordered check (ends_at > starts_at),
  constraint challenges_judging_known check (judging in ('score', 'votes')),
  constraint challenges_icon_known
    check (icon is null or icon in ('rain', 'sun', 'night', 'rarity', 'community', 'trophy')),
  constraint challenges_reward_nonnegative check (reward_xp >= 0)
);

create index challenges_window_idx on public.challenges (ends_at desc, starts_at desc);

comment on table public.challenges is
  'Authored rows. Status is derived from the window at read time; nothing rotates them.';

-- ---------------------------------------------------------------------------
-- challenge_entries
-- ---------------------------------------------------------------------------
--
-- One per player per challenge. The unique constraint is the product rule rather than
-- housekeeping: submitting a second photograph *moves* the entry, which is what the
-- submission screen tells the player before they commit.
--
-- Both foreign keys cascade, and here that is right where it is wrong elsewhere. An entry is
-- a photograph in a competition; with the photograph deleted there is no entry left to mean
-- anything. Compare `reveals`, which is ON DELETE SET NULL precisely so a spend outlives what
-- it was spent on.

create table public.challenge_entries (
  id uuid primary key default gen_random_uuid(),

  challenge_id uuid not null references public.challenges (id) on delete cascade,
  photo_id uuid not null references public.photos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  created_at timestamptz not null default now(),

  constraint challenge_entries_one_per_player unique (challenge_id, user_id)
);

create index challenge_entries_challenge_idx
  on public.challenge_entries (challenge_id, created_at desc);
create index challenge_entries_photo_idx on public.challenge_entries (photo_id);

comment on table public.challenge_entries is
  'One entry per player per challenge. A second submission moves the existing row.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Both readable by anyone signed in — a challenge is a public prompt and its entries are
-- public by definition, since entering shares the photograph to the feed.
--
-- Neither writable from the app. An entry decides who wins something, so it goes through the
-- API holding the service-role key for the reason §2 gives about anything that affects rank.

alter table public.challenges enable row level security;
alter table public.challenge_entries enable row level security;

create policy "Challenges are readable by anyone signed in"
  on public.challenges for select
  to authenticated
  using (true);

create policy "Entries are readable by anyone signed in"
  on public.challenge_entries for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Something to look at
-- ---------------------------------------------------------------------------
--
-- One active and one already closed, so the hub has both a card and a winners rail the first
-- time it is opened. Delete these once real ones are authored.

insert into public.challenges (title, prompt, starts_at, ends_at, judging, icon, reward_xp)
values
  (
    'Golden Hour',
    'A cat in the last light of the day. Warm, low, and unhurried.',
    now() - interval '1 day',
    now() + interval '6 days',
    'score',
    'sun',
    150
  ),
  (
    'Loaf of the Week',
    'Paws tucked, edges square. The tighter the loaf, the better.',
    now() - interval '9 days',
    now() - interval '2 days',
    'votes',
    'community',
    150
  );
