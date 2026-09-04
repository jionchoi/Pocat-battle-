-- Cat Frame — who revealed a score
--
-- One column. It exists because a score can now be paid for by somebody other than the
-- photographer, and once that is true "who unlocked this" is a fact the product has to keep
-- rather than infer.
--
-- Run in the Supabase SQL editor, after 2026-08-30_paw_spending.sql.
--
-- ---------------------------------------------------------------------------
-- Why the column is needed at all
-- ---------------------------------------------------------------------------
--
-- Three separate things now depend on knowing who paid, and none of them can be worked out
-- from the rows that already exist:
--
--   1. **The credit line.** A photograph revealed by a stranger says "Unlocked by @name" on
--      its detail screen. Revealed by its own owner it says nothing — that is the ordinary
--      case and does not need announcing.
--   2. **The XP.** Revealing earns the XP, and it goes to whoever spent the paws. Without
--      this column the app would have no record of who that was the moment the request ended.
--   3. **Taking the XP back.** Deleting a scored photograph revokes the XP it earned, and it
--      has to come out of the account that actually got it. Before this column that was always
--      the owner; now it is whoever this names, and revoking from the wrong person is a
--      silent, permanent error in somebody's progression.
--
-- The third is the one that makes this a column rather than a join against `paw_ledger`. A
-- ledger row carries `photo_id`, so the payer *is* recoverable from it — but `photo_id` is
-- `on delete set null`, and the exact moment the answer is needed is the moment the photo is
-- being deleted. The one source that would work is the one that disappears first.
--
-- ---------------------------------------------------------------------------
-- Always written, never inferred
-- ---------------------------------------------------------------------------
--
-- Set on every reveal including the owner's own, rather than left null to mean "the owner did
-- it". A null that means something is a null somebody will one day read as "unknown", and the
-- two are not the same: an old row from before this migration genuinely is unknown, and it
-- should not be reported as an owner reveal.
--
-- The serializers are where "do not show the owner their own name" happens, because that is a
-- presentation rule and not a fact about the row.

alter table public.photos
  add column if not exists revealed_by uuid references public.profiles (id) on delete set null;

-- `set null` rather than cascade, for the reason `reveals.photo_id` uses it: the reveal
-- happened whether or not the account that paid for it still exists. A deleted account must
-- not take somebody else's photograph, and a credit line falling back to "Unlocked by
-- someone" is the correct degrade.

comment on column public.photos.revealed_by is
  'Who paid for the score. Equals owner_id on an ordinary reveal; null only on rows scored before 2026-08-31.';

-- The query behind the credit line is by primary key, so no index is added. This column is
-- never filtered on, only read alongside the row it sits on — an index here would be write
-- cost for a lookup nothing performs.

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- Every score that exists today was revealed by the photograph's own owner: paying for
-- somebody else's is what this session added, and nothing before it could reach that path. So
-- the backfill is exact rather than a guess, and without it every existing scored photo would
-- read as "unknown" and be indistinguishable from a row this column failed to write.
--
-- Guarded on `revealed_by is null` so a re-run cannot overwrite an attribution written since.

update public.photos
   set revealed_by = owner_id
 where scored_at is not null
   and revealed_by is null;

-- ---------------------------------------------------------------------------
-- What is deliberately NOT granted
-- ---------------------------------------------------------------------------
--
-- No column grant, and the omission is the point — the same note `paw_count` carries.
--
-- 2026-08-07_create_photos_and_cats.sql revokes UPDATE on `photos` from `authenticated` and
-- grants it back on exactly `(caption, shared_to_feed, showcased)`. Grants are additive (trap
-- 9), so this column is unwritable by the app until somebody adds it to that list, and nobody
-- should: a client that could write `revealed_by` could put anybody's name under any
-- photograph, and — because the delete path revokes XP from whoever this names — could take
-- XP out of an account it does not own.
