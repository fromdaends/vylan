-- A task inside a task.
--
-- The last structural gap against Canopy's model. Their six object types map
-- onto Vylan already — a Client Request, an Organizer and an eSignature are all
-- request_items with a kind, living inside a document request task — except for
-- the SUBTASK: a step under a parent, with its own owner and its own due date.
--
-- ── ONE LEVEL, AND ONLY ONE ────────────────────────────────────────────────
--
-- A subtask cannot have subtasks. Enforced by a trigger, not by hope.
--
-- Canopy stops at three (Task → Subtask → Checklist item) and their checklist
-- item carries no assignee and no date, which makes it a different object, not
-- a third level of the same one. Vylan already has that object: request_items
-- inside a document request. So the honest depth here is two, and a tree of
-- arbitrary depth is the version where a progress bar has to recurse and
-- nobody can tell you what "3 of 7" counted.
--
-- ── WHAT A SUBTASK INHERITS, AND WHAT IT DOES NOT ──────────────────────────
--
-- Inherits: client_id, engagement_id, firm_id. A subtask of a task on the
-- Tremblay T1 is on the Tremblay T1; letting those differ would let a subtask
-- appear under a client its parent has nothing to do with. A trigger copies
-- them from the parent on write rather than trusting the caller.
--
-- Its own: title, status, assignees, due date, priority, notes. That is the
-- whole point — "Review the W-2s" is due before the return is, and Marie does
-- it while Sébastien does the rest.
--
-- ⚠️ SUBTASKS MUST NOT COUNT TWICE. Every count in the product — the task
-- table's rows, an engagement's progress bar, the dashboard's open-task number
-- — is over TOP-LEVEL tasks. A parent showing "2 of 5 done" is the subtask's
-- contribution; adding them to the same list as their parent would make a job
-- with one task and four subtasks read as five pieces of work.
--
-- Idempotent. Safe to run twice. No enum is created and none is written by a
-- CASE — see 1370 for why that sentence is in every one of these files.

alter table public.engagement_tasks
  add column if not exists parent_id uuid
    references public.engagement_tasks(id) on delete cascade;

-- The list is always read for one parent, in display order.
create index if not exists engagement_tasks_parent_idx
  on public.engagement_tasks (parent_id, order_index)
  where parent_id is not null;

-- ── the trigger: one level, and the parent's client ────────────────────────
create or replace function public.enforce_subtask_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A task cannot be its own subtask';
  end if;

  select id, firm_id, client_id, engagement_id, parent_id
    into parent
    from public.engagement_tasks
   where id = new.parent_id;

  if parent.id is null then
    raise exception 'Parent task % does not exist', new.parent_id;
  end if;

  -- ONE LEVEL. Without this a subtask could be given a subtask, and every
  -- count in the product would have to recurse to stay honest.
  if parent.parent_id is not null then
    raise exception 'A subtask cannot have subtasks';
  end if;

  if parent.firm_id <> new.firm_id then
    raise exception 'A subtask must belong to the same firm as its parent';
  end if;

  -- Copied, not trusted. A subtask filed against a different client than its
  -- parent would show up on a client page its parent has nothing to do with.
  new.client_id := parent.client_id;
  new.engagement_id := parent.engagement_id;

  return new;
end $$;

drop trigger if exists engagement_tasks_subtask_rules on public.engagement_tasks;
create trigger engagement_tasks_subtask_rules
  before insert or update of parent_id, client_id, engagement_id
  on public.engagement_tasks
  for each row execute function public.enforce_subtask_rules();

-- ── the one-per-kind rule applies to TOP-LEVEL tasks only ──────────────────
-- 1370 keeps one document request per job. A subtask is never one of those
-- kinds, but the index would still count it if somebody made one, so the rule
-- is narrowed to what it was always about.
drop index if exists public.engagement_tasks_one_per_kind_idx;
create unique index if not exists engagement_tasks_one_per_kind_idx
  on public.engagement_tasks (engagement_id, kind)
  where kind <> 'task' and engagement_id is not null and parent_id is null;

comment on column public.engagement_tasks.parent_id is
  'Set on a SUBTASK, pointing at its parent task. One level only — a trigger refuses a subtask of a subtask, and copies client_id and engagement_id from the parent rather than trusting the caller. ⚠️ Every count in the product (table rows, progress bars, open-task totals) is over TOP-LEVEL tasks: a parent shows its own "2 of 5", and listing subtasks alongside their parents would make one task with four subtasks read as five pieces of work.';

-- Verify after applying:
--
--   select count(*) from engagement_tasks where parent_id is not null;  --> 0
--   -- nothing became a subtask by being migrated.
--
--   -- one level holds (expect an error, then roll back):
--   begin;
--     with p as (select id, firm_id, client_id from engagement_tasks limit 1)
--     insert into engagement_tasks (firm_id, client_id, title, parent_id)
--     select firm_id, client_id, 'probe', id from p;
--     -- now try to nest under THAT row: must raise 'A subtask cannot have subtasks'
--   rollback;
