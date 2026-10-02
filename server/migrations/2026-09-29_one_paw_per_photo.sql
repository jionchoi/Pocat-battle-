-- Cat Frame — one paw per photograph, per player
--
-- Run in the Supabase SQL editor, after 2026-08-30_paw_spending.sql.
--
-- ---------------------------------------------------------------------------
-- What changed, and why it is a product decision rather than a bug fix
-- ---------------------------------------------------------------------------
--
-- `services/paws.ts` argued the opposite at length and the argument is worth restating before
-- it is overturned: a paw is a tip rather than a verdict, giving moves nothing ranked, and
-- there is no honest reason to cap how many times somebody may say "this one is good".
--
-- What that reasoning left out is what the control feels like under a thumb. An uncapped paw
-- button is a button whose meaning depends on how many times you press it, so the only way to
-- find out what a tap costs is to tap — and a player who taps twice has spent two of seven
-- weekly paws on one photograph without ever deciding to. The weekly grant is what makes this
-- bite: `PAW_GRANT` is small on purpose so that each gift means something, and a gesture that
-- can silently consume the whole allowance on one card is at odds with that.
--
-- So a paw is now one per photograph per player, which makes the button a state — given, or
-- not given — the way a reaction is. `paw_count` therefore becomes "how many people liked
-- this" rather than "how many taps this received", which is also the number the card has
-- always implied it was showing.
--
-- ---------------------------------------------------------------------------
-- Why a unique index and not just a check in the service
-- ---------------------------------------------------------------------------
--
-- Because the service check is what already failed. `give()` reads the grant, decides a
-- bucket, then writes — and a spammed button fires those reads concurrently, so every request
-- in the burst reads the same `remaining` and every one of them believes it is affordable.
-- The observed result was eleven gifts against a grant of seven.
--
-- A read-then-write guard in application code cannot fix that, however carefully it is
-- written: there is no transaction around it (see the note in `services/paws.ts`), so the gap
-- between the read and the write is always open. The database is the only place a "once"
-- can be stated, so it is stated here, and the service treats the resulting unique violation
-- as the ordinary refusal rather than as an error.
--
-- ---------------------------------------------------------------------------
-- The repair, and why it deletes rows from an append-only table
-- ---------------------------------------------------------------------------
--
-- `paw_ledger` is documented as append-only, and undo is supposed to write a compensating
-- `gift_undone` row rather than remove anything. That rule is deliberately broken once, here,
-- and it has to be: a unique index cannot be created over rows that already violate it, and
-- the rows that violate it are duplicate gifts that only exist because of the race above.
-- A compensating row would leave the duplicates in place and the index would still fail.
--
-- These are not gifts anybody decided to make. They are the same tap counted several times.
--
-- The deletion is symmetric — a surplus `gift_sent` and the `gift_received` it paid for go
-- together — because the wallet balance is `sum(delta)` over the ledger, so removing one side
-- alone would mint or destroy paws. Afterwards `photos.paw_count` is rebuilt from what
-- survives, since it is a cache of exactly this.
--
-- `paw_grants.remaining` is **not** refunded. It is a column rather than a ledger sum, and
-- whatever it says now is what these players have left; crediting it here would hand paws
-- back to whoever found the bug.

begin;

-- ---------------------------------------------------------------------------
-- 1. Surplus gifts, keeping the first of each
-- ---------------------------------------------------------------------------
--
-- Ranked by `created_at` with `id` as the tiebreak, because a burst of concurrent inserts can
-- land inside the same millisecond and `row_number()` needs a total order to be deterministic.
-- The earliest is the gift the player meant; the rest are the race.

create temporary table paw_surplus on commit drop as
with ranked as (
  select
    id,
    user_id,
    counterparty_id,
    photo_id,
    row_number() over (
      partition by user_id, photo_id
      order by created_at, id
    ) as nth
  from public.paw_ledger
  where reason = 'gift_sent'
    and photo_id is not null
)
select id, user_id, counterparty_id, photo_id, nth
from ranked
where nth > 1;

-- ---------------------------------------------------------------------------
-- 2. The receipts those surplus gifts paid for
-- ---------------------------------------------------------------------------
--
-- Paired by the triple that identifies a gift — photograph, giver, recipient — since the two
-- halves carry no shared id. `counterparty_id` is `on delete set null`, so a closed account
-- leaves a `gift_received` that can no longer be matched to its sender; those are left alone
-- deliberately. An unmatched receipt is a paw somebody already has in their wallet, and
-- removing it on a guess would take a real paw away from an uninvolved player.
--
-- The same `row_number()` keeps exactly one receipt per triple, so the pairing survives the
-- case where a recipient got several gifts on one photo from one giver.

-- How many receipts each (giver → recipient, photograph) pair has to lose: exactly as many as
-- that pair had surplus gifts.
create temporary table paw_surplus_receipts on commit drop as
with surplus_per_pair as (
  select
    user_id as giver,
    counterparty_id as recipient,
    photo_id,
    count(*) as surplus
  from paw_surplus
  group by user_id, counterparty_id, photo_id
),
ranked_receipts as (
  select
    r.id,
    r.user_id,
    r.counterparty_id,
    r.photo_id,
    -- Newest first, so the receipts that go are the ones the race added and the one that
    -- survives is the one paired with the gift the player meant to make.
    row_number() over (
      partition by r.user_id, r.counterparty_id, r.photo_id
      order by r.created_at desc, r.id desc
    ) as nth_from_last
  from public.paw_ledger r
  where r.reason = 'gift_received'
    and r.photo_id is not null
    and r.counterparty_id is not null
)
select rr.id
from ranked_receipts rr
join surplus_per_pair sp
  on sp.photo_id = rr.photo_id
 -- Mirrored: the receipt's owner is the gift's counterparty and vice versa.
 and sp.recipient = rr.user_id
 and sp.giver = rr.counterparty_id
where rr.nth_from_last <= sp.surplus;

-- ---------------------------------------------------------------------------
-- 3. Remove both halves
-- ---------------------------------------------------------------------------

delete from public.paw_ledger
where id in (select id from paw_surplus_receipts);

delete from public.paw_ledger
where id in (select id from paw_surplus);

-- ---------------------------------------------------------------------------
-- 4. Rebuild the display counter
-- ---------------------------------------------------------------------------
--
-- From the ledger, which is the authority. Only photographs that had a gift are touched: a
-- blanket update would rewrite `paw_count` to 0 on every row in the table, and a photo whose
-- gifts predate the ledger (there are none today, but the cache is older than the guard) would
-- silently lose its count.

update public.photos p
set paw_count = counted.n
from (
  select photo_id, count(*) as n
  from public.paw_ledger
  where reason = 'gift_sent'
    and photo_id is not null
  group by photo_id
) as counted
where p.id = counted.photo_id
  and p.paw_count is distinct from counted.n;

-- A photograph whose every gift was surplus now has no gift rows at all, so the aggregate
-- above cannot see it. Its counter still says what the race left there.
update public.photos p
set paw_count = 0
where p.paw_count > 0
  and not exists (
    select 1
    from public.paw_ledger l
    where l.photo_id = p.id
      and l.reason = 'gift_sent'
  );

-- ---------------------------------------------------------------------------
-- 5. The constraint
-- ---------------------------------------------------------------------------
--
-- Partial, because only gifts are capped. `purchase` and `challenge_prize` carry no photograph
-- at all, and a reveal spend (`paw_spending`) is charged per reveal rather than per photo — so
-- a unique index over the whole table would forbid a player ever spending twice on the same
-- photograph, which is a different rule nobody asked for.
--
-- `gift_undone` is excluded for the same reason it exists: a hand-made support reversal must
-- still be writable against a photograph that already has a gift on it.

create unique index if not exists paw_ledger_one_gift_per_photo
  on public.paw_ledger (user_id, photo_id)
  where reason = 'gift_sent' and photo_id is not null;

comment on index public.paw_ledger_one_gift_per_photo is
  'One paw per player per photograph. The service reads a 23505 on this as the ordinary '
  '"already given" refusal — it is the only guard that holds against a spammed button, since '
  'PostgREST gives the service no transaction to read-then-write inside.';

commit;
