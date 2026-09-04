-- Cat Frame — the paw economy (giving)
--
-- Paws are the in-app currency. A player gives them to *other people's* photographs, one tap
-- at a time, and they are the only thing in the product a player can run out of.
--
-- Run in the Supabase SQL editor, after 2026-08-12_community_layer.sql.
--
-- ---------------------------------------------------------------------------
-- What paws are not
-- ---------------------------------------------------------------------------
--
-- **Giving one feeds nothing ranked.** Not `community_score`, not the leaderboards, not
-- Photographer Rank, not `likes_received`. `paw_count` below is a display number and a gift
-- moves nothing else.
--
-- Amended 2026-08-31: *spending* a paw on a score reveal does earn XP, and therefore rank. See
-- 2026-08-30_paw_spending.sql and the note at the top of game/paws.ts. The promise that
-- survives is the one that mattered — rank unlocks cosmetics only, so paws buy progression and
-- still cannot buy power, and the shop's "Nothing here changes a score" is still true of
-- everything in the shop.
--
-- The free reactions in `votes` remain the only ranking input, and that separation is the
-- whole reason it is safe for this table to allow many paws from one person to one photo.
-- A vote is an opinion and there is exactly one per person; a paw is a tip and there is no
-- honest reason to cap how many times somebody may say "this one is good".
--
-- ---------------------------------------------------------------------------
-- Three buckets, two of them built here
-- ---------------------------------------------------------------------------
--
--   grant   — 7 per week, automatic, expires. `paw_grants` below.
--   wallet  — received, won, or bought. Never expires. Summed from `paw_ledger`.
--   vote    — one per challenge, castable only on a challenge entry. NOT BUILT.
--
-- The third is a future feature and nothing here builds it. What this migration does owe it
-- is not making it impossible: `paw_ledger.bucket` is a checked enum of two values today and
-- widening it is one `drop constraint` / `add constraint` pair, exactly as
-- 2026-08-28_five_reactions.sql widened `votes.reaction`. A boolean column would not have
-- had that property, which is why `bucket` is text.
--
-- ---------------------------------------------------------------------------
-- Idempotence
-- ---------------------------------------------------------------------------
--
-- `if not exists` throughout, so a re-run after a half-applied paste is safe. The named
-- constraints on the tables are inside their `create table`, so they come and go with it;
-- the two on `photos` are added separately and guarded, because that table already exists.

-- ---------------------------------------------------------------------------
-- paw_grants — the expiring half
-- ---------------------------------------------------------------------------
--
-- One row per player, created the first time they ask about their balance. Not backfilled
-- and not seeded on signup: a player who has never opened the app does not need a row, and
-- an INSERT here on every profile creation is a second place the economy starts.
--
-- ## Why there is no scheduled job
--
-- Nothing in this codebase runs on a schedule, and the long note at the top of
-- services/challenges.ts is the argument. Applied here: a weekly reset implemented as a cron
-- would have to touch every row in this table at the same instant, can be missed, and leaves
-- a player's balance wrong for as long as the tick is late. So the period is *settled lazily
-- on read* — when `now() - period_start` has passed the window, the service rolls the row
-- forward and resets `remaining` in the same request that was asking for the balance.
--
-- What that trades away: a player who does not open the app has a stale row sitting in this
-- table. Since the only thing that reads it is the request doing the settling, that is
-- unobservable.
--
-- ## The window is anchored, not restarted
--
-- `period_start` rolls forward by whole windows rather than being set to `now()`. Setting it
-- to now would drift the player's week later every time they were slow to open the app, and
-- a grant that arrives at a different hour each week is one nobody can plan around.
--
-- Unused paws are **not** carried over. `remaining` is reset to the full grant no matter how
-- many periods elapsed, which is what makes the grant a use-it-or-lose-it allowance rather
-- than a slow-filling second wallet — the wallet already exists and is the thing that
-- accumulates.

create table if not exists public.paw_grants (
  user_id uuid primary key references public.profiles (id) on delete cascade,

  -- The anchor. `period_start + PAW_GRANT_WINDOW` is when this grant expires, and it is what
  -- the client shows as "resets in three days".
  period_start timestamptz not null default now(),

  -- What is left of this period's grant.
  --
  -- Deliberately floored and NOT ceilinged. An upper bound would have to name the grant size,
  -- and the grant size lives in game/paws.ts as one constant so the period and the amount are
  -- a one-line change — a check constraint here would quietly make it a two-place change and
  -- the second place would be found by an error in production. The floor is the one that
  -- matters anyway: it is what makes an overspend impossible to represent.
  --
  -- The default is zero rather than the grant size for the same reason: a default naming the
  -- amount would be a second copy of it. Nothing relies on the default — `settleGrant` writes
  -- an explicit value on every insert, because the row's first value and its reset value are
  -- the same number and it comes from one place.
  remaining integer not null default 0,

  constraint paw_grants_remaining_nonnegative check (remaining >= 0)
);

comment on table public.paw_grants is
  'One row per player. Settled lazily on read — see services/paws.ts. Never carried over.';
comment on column public.paw_grants.period_start is
  'Anchor of the current grant window. Rolls forward by whole windows, never to now().';

-- ---------------------------------------------------------------------------
-- paw_ledger — every movement, append-only
-- ---------------------------------------------------------------------------
--
-- ## Why a ledger and not a counter column
--
-- A `profiles.paw_balance integer` would be one column and one UPDATE, and it was rejected.
-- A balance you cannot reconstruct is a balance you cannot refund, cannot support and cannot
-- audit: the first time somebody writes in saying paws went missing, the only available
-- answers are "the number says otherwise" and "here, have some". Neither is a support reply
-- and neither is true. Summing rows means the balance is always explainable — every paw has a
-- row saying where it came from, when, and who was on the other end.
--
-- It is also the only shape that survives the shop. Purchased paws and challenge prizes are
-- already in the `reason` enum below precisely so that adding them later is an INSERT rather
-- than a schema change.
--
-- ## Append-only, and a gift is final
--
-- Nothing in the app reverses a gift. A paw that has been given stays given: there is no
-- undo endpoint, no take-back window, and no player-facing action that writes a negative row
-- against a `gift_sent`. A gift that can evaporate is not a gift, and the person that matters
-- is the recipient, who would otherwise watch their count go down.
--
-- `gift_undone` is in the enum anyway, and it is not vestigial. It is the shape a **support
-- reversal** takes — run by hand, against this table, when somebody has been wronged. Being
-- able to do that at all is the entire argument for this being a ledger rather than a counter
-- column, and it is why a reversal is a new row rather than a DELETE: a ledger you can edit
-- is a spreadsheet.
--
-- ## Grant spending is written here too
--
-- A gift drawn from the grant decrements `paw_grants.remaining` **and** writes a row here
-- with `bucket = 'grant'`. So this table is the complete history of every paw that ever
-- moved, while the wallet balance sums only the `bucket = 'wallet'` rows. Two questions,
-- two answers, one table:
--
--   what happened?          — every row.
--   what can I still spend? — sum(delta) where bucket = 'wallet', plus paw_grants.remaining.

create table if not exists public.paw_ledger (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Signed. Negative is a paw leaving this player, positive is one arriving. Never zero — a
  -- row that moves nothing is a row that means nothing, and it would sum into a balance while
  -- explaining nothing about it.
  delta integer not null,

  reason text not null,

  -- Which pot the movement came out of or went into. See the note above about widening this
  -- when the challenge vote token is built.
  bucket text not null,

  -- The photograph the gift was for. Nullable because two of the five reasons have no photo
  -- (`purchase`, `challenge_prize`), and `on delete set null` for the reason `reveals` uses
  -- the same clause: a spend outlives the thing it was spent on. If the photograph is deleted
  -- the paw was still given, and neither side's balance may silently change because of it.
  photo_id uuid references public.photos (id) on delete set null,

  -- Who was on the other end: the recipient on a `gift_sent`, the giver on a `gift_received`.
  -- Also `set null` — an account closing must not rewrite anybody else's history.
  counterparty_id uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),

  constraint paw_ledger_delta_nonzero check (delta <> 0),

  -- The closed set of things that can move a paw. `purchase` and `challenge_prize` are
  -- unreachable today — nothing writes them — and they are here anyway, because the
  -- alternative is a constraint rewrite on a table with rows in it on the day the shop ships.
  constraint paw_ledger_reason_known check (
    reason in ('gift_sent', 'gift_received', 'gift_undone', 'purchase', 'challenge_prize')
  ),

  constraint paw_ledger_bucket_known check (bucket in ('grant', 'wallet'))
);

-- The balance query: one player's wallet rows. `created_at desc` rather than a bare index on
-- user_id, because the same index then serves a history screen, which is the obvious next
-- thing to want out of a table like this.
create index if not exists paw_ledger_user_idx
  on public.paw_ledger (user_id, created_at desc);

-- Everything that ever happened to one photograph. Partial, because two of the five reasons
-- carry no photo and there is no query that wants them here.
--
-- Nothing in the API reads this today: `photos.paw_count` answers "how many" without a scan,
-- and there is no undo to look up a specific gift for. It is kept for the two jobs the count
-- cannot do — rebuilding `paw_count` when the cache drifts, and answering a support question
-- about one photograph — both of which are exactly the situations where you do not want to be
-- adding an index to a large table under pressure.
create index if not exists paw_ledger_photo_idx
  on public.paw_ledger (photo_id, user_id, created_at desc)
  where photo_id is not null;

comment on table public.paw_ledger is
  'Append-only. Wallet balance is sum(delta) where bucket = wallet. Undo writes a row, never deletes one.';

-- ---------------------------------------------------------------------------
-- photos.paw_count
-- ---------------------------------------------------------------------------
--
-- Denormalised for display, exactly like `vote_count` beside it and for the same reason: a
-- feed page is thirty photographs and every card draws this number, so counting it per card
-- is thirty aggregates per scroll over the largest table in the product.
--
-- No trigger. 2026-08-12_community_layer.sql gives the reason and it holds here: a trigger
-- would be a second place the economy moves, and the ledger write it would have to stay in
-- step with is in the service. The service keeps this true in the same request that writes
-- the ledger, and the ledger is the authority if the two ever disagree.

alter table public.photos
  add column if not exists paw_count integer not null default 0;

do $$
begin
  alter table public.photos
    add constraint photos_paw_count_nonnegative check (paw_count >= 0);
exception
  -- Already applied. The `add column` above is guarded by `if not exists`; `add constraint`
  -- has no such clause, so this is how a re-run of this file gets past it. Deliberately
  -- narrow: any other failure still raises.
  when duplicate_object then null;
end $$;

comment on column public.photos.paw_count is
  'Paws given by other players. Display only — it feeds no ranked number. Cache of paw_ledger.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Both tables readable by their owner, writable by nobody. There is no insert, update or
-- delete policy on either and that is the entire security model: a row here is money, so the
-- only thing that may write one is the API holding the service-role key.
--
-- This is trap 17 applied before it bites rather than after. A client that could insert into
-- `paw_ledger` could credit itself; a client that could update `paw_grants` could hand itself
-- a fresh seven every second. RLS grants *rows*, so "the API is the only writer" has to be
-- enforced here and not assumed from a comment somewhere else.

alter table public.paw_grants enable row level security;
alter table public.paw_ledger enable row level security;

drop policy if exists "players read their own grant" on public.paw_grants;
create policy "players read their own grant"
  on public.paw_grants for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Your own rows only, which means a `gift_received` shows you who gave it and a stranger
-- cannot enumerate who is giving what to whom. The counterparty's copy of the same movement
-- is their row, under their id.
drop policy if exists "players read their own ledger" on public.paw_ledger;
create policy "players read their own ledger"
  on public.paw_ledger for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- What is deliberately NOT granted
-- ---------------------------------------------------------------------------
--
-- `photos.paw_count` gets no column grant, and the omission is the point.
--
-- 2026-08-07_create_photos_and_cats.sql revokes UPDATE on `photos` from `authenticated` and
-- grants it back on exactly `(caption, shared_to_feed, showcased)`. Column grants are
-- additive (trap 9), so a new column is unwritable by the app until somebody grants it — and
-- nobody should. A client that could write `paw_count` could put any number under any
-- photograph, including its own.
--
-- This paragraph exists because the reflex on adding a column to a table with a column grant
-- on it is to extend the grant. Here, doing nothing is the correct action.
