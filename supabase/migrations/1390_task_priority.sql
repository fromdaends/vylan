-- A task can carry a priority.
--
-- The founder asked for the Tasks screen to work the way Canopy's does, and
-- Priority is one of its columns. This is the only field in that screenshot
-- Vylan did not already have.
--
-- ⚠️ I ARGUED AGAINST THIS COLUMN ONCE, and the note is worth keeping rather
-- than quietly reversing: in Canopy's own demo the priority column reads "No
-- priority" on all 490 rows, so I called it a control everybody ignores that
-- still costs a column forever. That was the right call when nobody had asked
-- for it. It is the wrong call now that the founder has — a field they intend
-- to use is not the same object as a field copied because a competitor has one.
--
-- Defaults to 'none' so nothing existing changes, and 'none' is a REAL value
-- rather than null: "nobody has decided" and "explicitly not urgent" are the
-- same thing here, and two ways to say it means two code paths forever.
--
-- ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
--
-- The founder also sent Canopy's six task-object models. Four of them already
-- exist in Vylan under other names — a Client Request, an Organizer and an
-- eSignature are all request_items with a kind, sitting inside a document
-- collection task. What Vylan genuinely lacks is Canopy's SUBTASK: a task
-- nested under a task, with its own assignee and due date. That is a structural
-- change (a parent_id and every query that reads the table), and it is not in
-- this migration on purpose.
--
-- Idempotent. Safe to run twice.
--
-- ⚠️ No enum is created here, and none is written to. 1370 aborted because a
-- CASE resolves to TEXT and cannot coerce into an enum column; a plain text
-- column with a check constraint has no such trap and reads the same.

alter table public.engagement_tasks
  add column if not exists priority text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'engagement_tasks_priority_check'
  ) then
    alter table public.engagement_tasks
      add constraint engagement_tasks_priority_check
      check (priority in ('none', 'low', 'medium', 'high'));
  end if;
end $$;

comment on column public.engagement_tasks.priority is
  'none | low | medium | high. ''none'' is a real value, not a null — "nobody decided" and "not urgent" are the same state here, and two ways to say it is two code paths forever.';

-- Sorting the firm-wide list by what is urgent, which is the entire reason the
-- column exists. Partial: the overwhelming majority of rows will be 'none' and
-- indexing those buys nothing.
create index if not exists engagement_tasks_priority_idx
  on public.engagement_tasks (firm_id, priority)
  where priority <> 'none';

-- Verify after applying:
--
--   select priority, count(*) from engagement_tasks group by priority;
--   --> every existing row is 'none'; nothing was reprioritised by a migration.
--
--   select count(*) from engagement_tasks;   --> unchanged
