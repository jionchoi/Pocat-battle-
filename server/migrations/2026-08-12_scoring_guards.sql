-- Cat Frame — remembering what the scorer already said
--
-- Two columns, and both exist for the same reason: a scoring call costs real money, and
-- nothing in the schema stopped the same photograph being sent twice for an answer we
-- already had.
--
-- The pipeline was safe against *accidental* repeats and nothing else. `photos.scored_at`
-- stops a scored photo being re-scored, which covers the successful case completely. It
-- says nothing about the two failures, because a failure leaves the row exactly as it was:
-- unscored, and therefore eligible to be sent again. Forever.
--
--   no_cat_at         — the model looked and there was no cat. Asking again buys the same
--                       sentence at the same price. The photograph would have to change for
--                       the answer to change, and a changed photograph is a new capture.
--
--   scoring_attempts  — everything else. A scorer having a bad minute is worth retrying and
--                       an app in a retry loop is not, and from the server's side those look
--                       identical until you count.
--
-- Run in the Supabase SQL editor, or:
--   psql "$DIRECT_URL" -f migrations/2026-08-12_scoring_guards.sql

alter table public.photos
  add column no_cat_at timestamptz,
  add column scoring_attempts integer not null default 0;

comment on column public.photos.no_cat_at is
  'Set when the scorer reported no cat. While set, the photo is never sent to the model again.';

comment on column public.photos.scoring_attempts is
  'Model calls made for this photo, successful or not. Capped server-side so a retry loop cannot bill indefinitely.';

-- ---------------------------------------------------------------------------
-- Not in the scored-together constraint, deliberately
-- ---------------------------------------------------------------------------
--
-- `photos_scored_together` requires every score column to arrive at once or not at all.
-- These two are not score columns — they describe *attempts*, which is a different thing
-- from a verdict, and a photograph can accumulate attempts while remaining honestly
-- unscored. Adding them to that constraint would make "we tried and failed" unrepresentable,
-- which is precisely the state this migration exists to record.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- None. `update` on the whole table is already revoked from `authenticated` and the grant
-- names only the four fields a player owns, so these are unwritable from the app by
-- default. That is the correct posture and worth stating rather than leaving to inference:
-- a client that could zero `scoring_attempts` or clear `no_cat_at` would have an unmetered
-- billing endpoint.

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- Every photograph already scored took at least one call to score. Recording that keeps the
-- counter meaning "calls made" from the start rather than "calls made since this deployed" —
-- the second is a number that quietly lies for the lifetime of every existing row.
--
-- Photos that failed before today are left at zero. There is no record of what happened to
-- them, and inventing one would be worse than the undercount.

update public.photos
   set scoring_attempts = 1
 where scored_at is not null;
