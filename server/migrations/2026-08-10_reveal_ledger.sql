-- Cat Frame — the reveal ledger
--
-- ## Why this exists, having been argued against
--
-- The photos migration says the allowance is counted from `photos.scored_at` and that a
-- ledger table would be a second copy of a fact the rows already carry. That reasoning was
-- right about the question it was answering and wrong about a question it did not ask:
-- what happens to the count when the photo is deleted.
--
-- Counting rows means the count forgets. Deleting a scored photo hands its reveal back, so
-- the free tier's two-a-day is really unlimited for anyone willing to delete — score, look,
-- dislike it, delete, score again. That was true from the moment DELETE /photos/:id shipped.
--
-- It also blocks the rule the album cap needs: a player who scores a photo and then discards
-- it to stay under the cap has spent the reveal, and must not be refunded for choosing the
-- other branch of a prompt.
--
-- So the fact moves to a row that outlives the photograph. The two tables are not two copies
-- of one fact — they answer different questions, and each is now the only place its own
-- answer lives:
--
--   photos.scored_at  — is THIS photo scored? Still the only source. Still what the check
--                       constraint enforces and what the album reads.
--   reveals           — how many reveals has this player spent in the window? Now the only
--                       source, and the only one that can outlive a delete.
--
-- Run in the Supabase SQL editor, or:
--   psql "$DIRECT_URL" -f migrations/2026-08-10_reveal_ledger.sql

create table public.reveals (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Nullable, and ON DELETE SET NULL rather than cascade — the entire point. Cascade would
  -- reproduce the bug this table exists to fix, one indirection further away and harder to
  -- see. When the photograph goes, this row stays and forgets which photo it was.
  --
  -- That is also what keeps "delete means gone" honest: what survives a deletion is the
  -- fact that a reveal was spent at a time, carrying nothing about the picture, where it
  -- was taken or what it scored.
  photo_id uuid references public.photos (id) on delete set null,

  -- The moment the score was written. Copied from the same clock that stamps
  -- `photos.scored_at`, in the same transaction-shaped step, so a photo and its ledger row
  -- agree about when it happened.
  scored_at timestamptz not null default now()
);

-- The allowance query, and the only query this table has: rows for one player inside a
-- rolling window, oldest first so the head of the window says when a slot frees up.
create index reveals_window_idx on public.reveals (user_id, scored_at desc);

comment on table public.reveals is
  'One row per score spent. Outlives the photo on purpose: deleting a photograph must not refund its reveal.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- Every score already written happened, and the window is 24 hours wide, so anything scored
-- recently is still inside it. Without this the ledger starts empty and every existing
-- player is handed a fresh allowance the moment this deploys.

insert into public.reveals (user_id, photo_id, scored_at)
select owner_id, id, scored_at
  from public.photos
 where scored_at is not null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Readable by its owner so a client could show its own history; not writable by anyone.
-- There is no insert, update or delete policy and that is the whole security model for this
-- table — a row here costs a player a score, so the only thing that may write one is the
-- pipeline holding the service-role key. A client that could delete from this table would
-- have the unlimited rerolls the table exists to prevent.

alter table public.reveals enable row level security;

create policy "players read their own reveals"
  on public.reveals for select
  to authenticated
  using ((select auth.uid()) = user_id);
