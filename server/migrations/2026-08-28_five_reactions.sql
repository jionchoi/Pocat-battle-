-- Cat Frame — five reactions
--
-- Widens `votes.reaction` from three kinds to five. Run in the Supabase SQL editor, after
-- 2026-08-12_community_layer.sql.
--
-- ---------------------------------------------------------------------------
-- What changed and why
-- ---------------------------------------------------------------------------
--
-- The feed post used to carry one button per reaction, so the set was capped at three by the
-- width of a card rather than by what is worth saying about a photograph. The client now draws
-- them as a tapback tray — a stack of faces that opens into the full set — which decouples the
-- two, and the set grew to the five a messaging app would offer: love, laugh, wow, melt, fire.
--
-- The three existing spellings are untouched. There are rows in this table holding 'laugh',
-- 'love' and 'wow', and renaming any of them would orphan real votes for nothing: the client's
-- new labels ("Love it", "Funny", "Wow") are presentation and live in constants/game.ts.
--
-- ---------------------------------------------------------------------------
-- Idempotence
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than altered, because a check constraint cannot be widened in
-- place. `if exists` on the drop makes a re-run safe; the add is not conditional, because a
-- second run reaching it means the drop did not happen and that is worth failing over.
--
-- The rewrite validates every existing row against the new predicate. The old set is a strict
-- subset of the new one, so nothing can fail validation — but the table is locked for the
-- scan, which is why this is its own migration rather than a line inside a larger one.

alter table public.votes
  drop constraint if exists votes_reaction_known;

alter table public.votes
  add constraint votes_reaction_known
    check (reaction in ('love', 'laugh', 'wow', 'melt', 'fire'));

comment on column public.votes.reaction is
  'One of love | laugh | wow | melt | fire. Mirrors REACTIONS in server/src/game/community.ts '
  'and src/constants/game.ts. All five are positive — there is deliberately no downvote.';
