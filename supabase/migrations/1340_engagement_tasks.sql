-- The firm's OWN work list. Phase 4, step 1.
--
-- Across every migration before this one, Vylan has had no internal work
-- object. The checklist your staff look at on a job is the exact same set of
-- rows the client sees in their portal — request_items — and it belongs to the
-- client. Nothing anywhere represents work THE FIRM does.
--
-- That is why "assign each step separately", the thing the founder correctly
-- identified as missing, could not simply be a column on request_items:
-- assigning "Upload your T4" to a staff member is incoherent. It is the
-- CLIENT'S row. The firm's step is a different sentence — "review the trial
-- balance", "call about the missing invoice" — and it needs a different table.
--
-- ── THE WALL ────────────────────────────────────────────────────────────────
--
-- This table is NEVER read by the portal. The portal renders request_items and
-- uploaded_files; it has no route, query or component that touches this table,
-- and it must never gain one. That is the whole guarantee: the client cannot
-- see the firm's notes to itself because the code that draws the client's page
-- does not know this table exists.
--
-- Enforced structurally rather than by a flag. A `visible_to_client boolean`
-- would be one wrong default away from leaking every internal note a firm has
-- ever written, and somebody would eventually add "share this one with the
-- client" and mean it kindly.
--
-- ── WHO CAN SEE IT ──────────────────────────────────────────────────────────
--
-- Exactly whoever can see the engagement, via the same helper every other
-- child table uses: `not engagement_is_private(engagement_id)`. So client
-- membership (1240), per-job access (1320) and the outsider rules (1300) all
-- apply here for free, and none of them had to be re-decided.
--
-- ── STATUS IS THREE VALUES, ON PURPOSE ──────────────────────────────────────
--
-- todo / doing / done. Not the engagement's six-stage lifecycle: a stage is
-- where the JOB is, and a task is a thing one person does in an afternoon.
-- Borrowing the lifecycle here would mean a task could be "awaiting payment".
--
-- Idempotent throughout. Safe to run twice.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'engagement_task_status') then
    create type engagement_task_status as enum ('todo', 'doing', 'done');
  end if;
end $$;

create table if not exists engagement_tasks (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  title text not null,
  -- Free text the firm writes to itself. No _fr twin, unlike request_items:
  -- those are shown to a client in their own language, and this is never shown
  -- to a client at all.
  notes text,
  -- THE POINT OF THE WHOLE TABLE. Nullable: an unassigned step is a real state
  -- ("somebody needs to do this"), and forcing a name at creation is how a list
  -- ends up assigned entirely to whoever made it.
  assigned_user_id uuid references users(id) on delete set null,
  status engagement_task_status not null default 'todo',
  due_date date,
  order_index integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);

-- The list is always read for one engagement in display order.
create index if not exists engagement_tasks_engagement_idx
  on engagement_tasks (engagement_id, order_index);
-- "What is on my plate" across the firm — the query phase 6's planner will ask,
-- and cheap to add now rather than after there are rows.
create index if not exists engagement_tasks_assignee_idx
  on engagement_tasks (assigned_user_id) where assigned_user_id is not null;

alter table engagement_tasks enable row level security;

-- Same read arm as every other engagement child (0810/0850). Writing is open to
-- anybody who can see it: a task list where only the owner may tick something
-- off is a task list nobody uses.
drop policy if exists engagement_tasks_all on engagement_tasks;
create policy engagement_tasks_all on engagement_tasks for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.engagement_is_private(engagement_id)
    )
  )
  with check (firm_id = public.current_firm_id());

revoke all on engagement_tasks from anon;
grant select, insert, update, delete on engagement_tasks to authenticated;

comment on table engagement_tasks is
  'The FIRM''s internal work on an engagement — its own steps, each with an owner, status and due date. Completely separate from request_items, which is the CLIENT''s checklist. Never read by the portal, and that is structural: no portal route queries this table.';

-- Verify after applying:
--
--   select count(*) from engagement_tasks;   --> 0
--
--   -- and the wall, which is the thing worth checking:
--   -- open any client's portal link and confirm nothing new appears on it.
--   -- The portal reads request_items only; if a task ever shows up there,
--   -- something has queried this table from the portal side and the guarantee
--   -- at the top of this file has been broken.
