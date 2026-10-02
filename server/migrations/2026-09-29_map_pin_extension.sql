-- Cat Frame — keeping a pin on the map for longer, and never expiring your own
--
-- Run in the Supabase SQL editor, after 2026-08-30_paw_spending.sql.
--
-- ---------------------------------------------------------------------------
-- What this is for
-- ---------------------------------------------------------------------------
--
-- A pin currently lives `SIGHTING_TTL_HOURS` — 72 — from `captured_at`, and the argument for
-- that is sound: a pin is a claim about where a cat *is*, and a three-week-old claim is not
-- information. `services/map.ts` applies it to every row uniformly.
--
-- Two things are wrong with applying it uniformly.
--
-- **Your own captures.** `routes/map.ts` justifies authenticating this endpoint on the grounds
-- that the map's most valuable case is "finding your way back to a cat you photographed
-- yourself" — which is why the viewer's own pins are served at true coordinates while everyone
-- else's are coarsened. But the cutoff is applied before the viewer is considered, so that case
-- stops working after three days, and the "My photos" layer on `MapScreen` can only ever show
-- the last three days of a player's life. The TTL is about *other people's* claims being stale;
-- your own history is a record, and a record does not expire. No column is needed for this —
-- `services/map.ts` simply stops applying the cutoff to `owner_id = viewer`.
--
-- **Somebody else's cat that is genuinely still there.** A cat on a particular wall every
-- evening for a year is a true claim that the TTL deletes every three days. There is no way for
-- anyone to say so, and the owner is the person who knows.
--
-- So: `map_pin_until`, a per-photograph override, bought with paws.
--
-- ---------------------------------------------------------------------------
-- Why paws, and why this is the right thing to sell
-- ---------------------------------------------------------------------------
--
-- Everything paws buy today is either cosmetic (a filter) or a shortcut past a wait (a reveal).
-- This is the first thing they buy that another player receives: a pin kept alive is a pin
-- other people can still walk to. That makes it the best possible sink for a currency whose
-- supply comes from *being given* paws — the wallet fills because strangers liked your
-- photographs, and it empties into keeping one of those photographs findable.
--
-- It is also self-limiting in a way a cosmetic is not. Extending a pin on a cat that has moved
-- on buys nothing anybody wants, so the spend is only worth making where the claim is true.
--
-- Deliberately **not** a way to buy reach. An extension keeps a pin visible for longer; it does
-- not move it up the feed, does not touch `community_score`, `featured` or any ranked number,
-- and does not coarsen any less. The only thing money changes is *how long*, never *how high* —
-- see the note in `game/shop.ts` about Pro being the one non-cosmetic entry.

begin;

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
--
-- Nullable, and null is the meaningful default: it means "the ordinary TTL applies", which is
-- what every existing row wants. A `not null default now() + interval '72 hours'` would look
-- tidier and would be a lie — it would bake today's TTL into every row, so changing
-- `SIGHTING_TTL_HOURS` would stop affecting anything already captured.
--
-- An absolute timestamp rather than a count of extensions, because the question the map asks is
-- "is this pin still live", and a count makes every reader re-derive the answer from
-- `captured_at` plus a constant it would have to agree about. This column is the answer.

alter table public.photos
  add column if not exists map_pin_until timestamptz;

comment on column public.photos.map_pin_until is
  'Paw-funded override for the map pin TTL. Null means the ordinary SIGHTING_TTL_HOURS from '
  'captured_at applies. A pin is live when it is inside that window OR map_pin_until is in the '
  'future OR the viewer owns it. Never affects ranking, only visibility duration.';

-- ---------------------------------------------------------------------------
-- The index
-- ---------------------------------------------------------------------------
--
-- The map's query is a bounding box AND a liveness test, and the liveness test is now a
-- disjunction — `captured_at >= cutoff OR map_pin_until >= now()`. Postgres cannot use one
-- index for both arms of an OR, so this one exists for the second arm.
--
-- Partial on `map_pin_until is not null`, which is the point: almost no row will ever have an
-- extension, so the index stays a fraction of the table's size no matter how large `photos`
-- gets. `shared_to_map` is folded into the predicate for the same reason it is in the feed's
-- indexes — an unshared photo is never a candidate.

create index if not exists photos_map_pin_until_idx
  on public.photos (map_pin_until desc)
  where map_pin_until is not null and shared_to_map;

-- ---------------------------------------------------------------------------
-- The grant
-- ---------------------------------------------------------------------------
--
-- Deliberately **not** granted to `authenticated`. Every other owner-editable column on this
-- table — caption, shared_to_feed, showcased, shared_to_map — is something the player may set
-- freely, and this one costs paws. A player who could write it directly would extend their pins
-- for nothing, which is the same shape as trap 17 (granting yourself Pro).
--
-- So it is service-role only, written by `POST /photos/:id/map-pin` after the wallet has
-- actually been debited. This is the second column on `photos` with that property, the other
-- being the scoring columns, and the reasoning is identical: if spending it is the only way to
-- get it, the write has to happen where the spending is verified.

-- ---------------------------------------------------------------------------
-- The reason
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than altered — a check constraint cannot be widened in place,
-- the same note 2026-08-28_five_reactions.sql makes. The rewrite validates every existing row,
-- and the old set is a strict subset, so nothing can fail.
--
-- `pin_extension` rather than reusing `purchase`: `purchase` means "bought a thing from the
-- catalogue" and carries an `entry_id` naming which catalogue row. An extension buys time on
-- one specific photograph, which `photo_id` already records, and reading a ledger where those
-- two spends share a name would make "what did I spend my paws on" unanswerable.

alter table public.paw_ledger
  drop constraint if exists paw_ledger_reason_known;

alter table public.paw_ledger
  add constraint paw_ledger_reason_known check (
    reason in (
      'gift_sent',
      'gift_received',
      'gift_undone',
      'purchase',
      'reveal',
      'pin_extension',
      'challenge_prize'
    )
  );

commit;
