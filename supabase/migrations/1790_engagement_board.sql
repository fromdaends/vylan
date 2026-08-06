-- The capacity board's two missing columns. Only two.
--
-- ── WHAT THE HANDOFF ASKED FOR, AND WHY THIS IS SHORTER ────────────────────
--
-- `design_handoff_engagements_board/README.md` asks for four columns:
-- assignee_id, budget_minutes, actual_minutes and board_rank. Two of them
-- already have homes, and adding them again would have created exactly the
-- duplicate-source-of-truth this repo has been bitten by before:
--
--   * ASSIGNEE — `engagements.assigned_user_id` has existed for a long time and
--     is what the workflow engine writes on stage entry (effects.ts). A second
--     `assignee_id` would mean the board and the engine disagreed about who
--     owns a job within a week.
--
--   * ACTUAL — time tracking shipped (#1455 / #1459 / #1464). `time_entries`
--     is the record of hours worked, and a stored `actual_minutes` would be a
--     copy that drifts the moment somebody edits an entry. Actual is SUMMED
--     from time_entries at read time.
--
-- What is genuinely missing is a planned budget and a manual ordering.

-- Hours PLANNED for this engagement, in minutes.
--
-- Minutes, not hours: every other duration in this codebase is stored in
-- minutes (time_entries) and a second unit is a rounding bug waiting to be
-- introduced at the boundary. NULL = nobody has budgeted this job, which is a
-- real state and reads as "—" rather than as zero — a job with no budget is not
-- a job with no time to spend on it.
alter table public.engagements
  add column if not exists budget_minutes integer;

-- Manual order within a board column.
--
-- NULL for everything that already exists, deliberately: a column whose cards
-- have never been dragged falls back to the list's own ordering (due date, then
-- recency) rather than to an arbitrary rank nobody chose. Cards sort
-- rank-first-nulls-last, so one drag does not scramble the untouched rest.
--
-- Double precision, not integer: dropping a card between two neighbours takes
-- the midpoint of their ranks, which stays exact for far longer than integers
-- allow and avoids rewriting every row in the column on every drop.
alter table public.engagements
  add column if not exists board_rank double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'engagements_budget_minutes_check'
  ) then
    -- Negative planned time is not a budget, it is a typo.
    alter table public.engagements
      add constraint engagements_budget_minutes_check
      check (budget_minutes is null or budget_minutes >= 0);
  end if;
end $$;

comment on column public.engagements.budget_minutes is
  'Planned hours for this engagement, in minutes. NULL = not budgeted (renders "—", never 0). Actual is summed from time_entries, never stored here.';
comment on column public.engagements.board_rank is
  'Manual order within a capacity-board column. NULL = never dragged; sorts last and falls back to the list ordering. Double so a drop can take the midpoint of its neighbours.';
