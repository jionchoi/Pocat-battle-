-- Cat Frame — spending paws
--
-- The other half of the economy. 2026-08-29 built giving; this builds the two things a paw
-- can be spent on, and the table that records what a spend bought.
--
-- Run in the Supabase SQL editor, **after** 2026-08-29_paws.sql.
--
-- ---------------------------------------------------------------------------
-- What can be bought, and out of which pocket
-- ---------------------------------------------------------------------------
--
--   a score reveal  — your own photograph, once the free allowance is gone, or somebody
--                     else's at any time. See services/photos.ts.
--   a catalogue item — a filter, frame or theme that has been given a paw price.
--
-- **Both come out of the wallet and never out of the grant.** That is the rule the original
-- three-bucket table stated and it is worth restating in the schema, because it is the one
-- thing here that could be quietly loosened later: the weekly grant exists to be *given away*.
-- If it could also buy reveals, then a player who spends it on themselves has strictly more
-- than a player who gives it to other people, and the whole point of a free weekly allowance
-- is that giving costs nothing. The wallet is what receiving fills, so spending is funded by
-- having been generous — or by paying.
--
-- The enforcement is in `services/paws.ts`, which is the only writer. Nothing in SQL can
-- express "this column may only fall for these reasons", and a check constraint that tried
-- would have to know why a row was written.

-- ---------------------------------------------------------------------------
-- A new reason, and a column to say what was bought
-- ---------------------------------------------------------------------------
--
-- `purchase` already existed for a catalogue unlock. `reveal` is added beside it rather than
-- folded into it, because the two answer different support questions — "what have I bought"
-- and "what have I paid to look at" — and telling them apart from `photo_id is not null`
-- would be inferring a reason from a foreign key.
--
-- Dropped and recreated rather than altered, because a check constraint cannot be widened in
-- place. Same shape as 2026-08-28_five_reactions.sql, and safe to re-run: the drop is
-- conditional and the old set is a strict subset of the new one, so the revalidating scan
-- cannot fail.

alter table public.paw_ledger
  drop constraint if exists paw_ledger_reason_known;

alter table public.paw_ledger
  add constraint paw_ledger_reason_known check (
    reason in ('gift_sent', 'gift_received', 'gift_undone', 'purchase', 'reveal', 'challenge_prize')
  );

-- What the paws bought, when there is no photograph to point at.
--
-- The ledger's whole justification is that a balance can be explained to the person who lost
-- it, and "40 paws left your wallet for a purchase" does not explain anything. `entitlements`
-- below records the same fact from the other side, but reconciling the two by timestamp is
-- the kind of join nobody does at the moment they actually need the answer.
--
-- Deliberately `text` and deliberately not a foreign key. The catalogue is authored in
-- `game/shop.ts` and has no table, so there is nothing to reference — and if the catalogue
-- ever moves into the database, a ledger row must still name what was bought after the item
-- has been withdrawn from sale.
alter table public.paw_ledger
  add column if not exists entry_id text;

comment on column public.paw_ledger.entry_id is
  'Catalogue id for a purchase. Null on everything else. Text, not a key — see the migration.';

-- ---------------------------------------------------------------------------
-- entitlements
-- ---------------------------------------------------------------------------
--
-- The table `ownsEntry` in game/shop.ts has been waiting on since it was written. Its comment
-- says a purchasable cosmetic is "always false, and that is truthful *only because nothing can
-- be bought yet*" — this is the migration that makes it untruthful, so `ownsEntry` gains a
-- branch in the same change and `check-shop.ts` is updated to cover it.
--
-- ## Why this is not `profiles.owned_items text[]`
--
-- An array column would be one less table and it loses the two facts that matter after the
-- sale: **when**, and **what it cost**. Both are support answers. A player writing in to say
-- they were charged for a filter they do not have is answerable with a row and unanswerable
-- with an array element.
--
-- ## Rank unlocks are not in here
--
-- Reaching rank 4 does not write a row. Rank entitlement is arithmetic over a number the
-- database already has, and storing it would create a second copy that goes stale the moment
-- a rank changes — and worse, would have to be *revoked* if it ever fell. This table is only
-- for things that were acquired, and acquisitions do not expire.

create table if not exists public.entitlements (
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- The `CatalogEntry.id` from game/shop.ts. Text for the reason given above.
  entry_id text not null,

  -- What it actually cost, at the moment it was bought.
  --
  -- Copied rather than looked up, because the catalogue's prices are authored and will change.
  -- A refund six months from now has to be for what the player paid, not for what the item
  -- happens to list at today.
  paw_cost integer not null,

  acquired_at timestamptz not null default now(),

  -- One row per player per item. Buying something twice is a bug, and this is what makes it
  -- unrepresentable rather than merely unlikely — the service checks first, but a check that
  -- races itself is not a constraint.
  primary key (user_id, entry_id),

  constraint entitlements_cost_nonnegative check (paw_cost >= 0)
);

comment on table public.entitlements is
  'What a player has bought. Rank unlocks are NOT here — those are arithmetic, see game/shop.ts.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Readable by its owner, writable by nobody, exactly like `paw_grants` and `paw_ledger`.
--
-- This is the table trap 17 would be about if it were written today: a client that could
-- insert here would grant itself every cosmetic in the shop, and a client that could update
-- `paw_cost` would rewrite what it paid. There is no insert, update or delete policy, so the
-- API's service-role key is the only writer.

alter table public.entitlements enable row level security;

drop policy if exists "players read their own entitlements" on public.entitlements;
create policy "players read their own entitlements"
  on public.entitlements for select
  to authenticated
  using ((select auth.uid()) = user_id);
