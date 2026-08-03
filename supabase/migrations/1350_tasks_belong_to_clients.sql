-- A task belongs to a CLIENT. A job is optional.
--
-- 1340 shipped engagement_tasks with engagement_id NOT NULL — the firm's own
-- steps, living inside one job. The founder's call on 4 August widens that:
--
--   "i want to have a way to create tasks that dont live within an engagement
--    but they would still be tied to a client"
--
-- Which is right, and the example that makes it obvious: a client gets a CRA
-- notice and somebody has to phone about it. That is real work, it belongs to
-- that client, and it is not part of any tax return. Today it has nowhere to
-- go except a fake job invented to hold it.
--
-- ── THE TABLE KEEPS ITS NAME ────────────────────────────────────────────────
--
-- engagement_tasks stays engagement_tasks. The founder asked for no renames
-- and they are right that it buys nothing: a table name is not a user-facing
-- word, and renaming it would touch every reader for zero visible gain. The
-- name is now slightly wrong and that is a fair trade.
--
-- ── SAFE TO RESHAPE, VERIFIED RATHER THAN ASSUMED ───────────────────────────
--
-- The table is EMPTY in production (checked via PostgREST before writing this:
-- select on engagement_tasks returns []). So client_id can be added NOT NULL
-- with no backfill and no window where a row violates it. The backfill below
-- runs anyway, because a firm that applied 1340 and used it before this lands
-- would otherwise lose the column's constraint.
--
-- ── MULTIPLE ASSIGNEES, and why now rather than later ───────────────────────
--
-- The founder said yes to more than one person on a task. It is the one change
-- here that cannot be added cheaply afterwards: a single assigned_user_id
-- column becomes a join table only by rewriting every read of it. With the
-- table empty, this costs nothing. In a month it costs a migration, a backfill
-- and a sweep of every query.
--
-- assigned_user_id is LEFT IN PLACE and kept in sync for one release rather
-- than dropped, so a deployment still running 1340's code does not break on a
-- missing column. It stops being read the moment this ships.
--
-- Idempotent throughout. Safe to run twice.

-- ── the client, which is now the real parent ───────────────────────────────
alter table public.engagement_tasks
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- Backfill from the job for any row that predates this. Empty in production,
-- but a no-op statement that is correct beats a comment claiming it is one.
update public.engagement_tasks t
   set client_id = e.client_id
  from public.engagements e
 where t.engagement_id = e.id
   and t.client_id is null;

-- Only enforce NOT NULL once nothing violates it — a conditional so a re-run,
-- or a firm with an odd row, gets a clear failure rather than a half-applied
-- migration.
do $$
begin
  if not exists (select 1 from public.engagement_tasks where client_id is null) then
    alter table public.engagement_tasks alter column client_id set not null;
  end if;
end $$;

-- ── the job, which is now optional ─────────────────────────────────────────
alter table public.engagement_tasks
  alter column engagement_id drop not null;

create index if not exists engagement_tasks_client_idx
  on public.engagement_tasks (client_id);

comment on column public.engagement_tasks.client_id is
  'The task''s real parent. Required: every task is for somebody.';
comment on column public.engagement_tasks.engagement_id is
  'Optional (1350). Set it and the task also appears on that job; leave it null and the task belongs to the client alone — "call the CRA about the notice".';

-- ── who is doing it: a join table, not a column ────────────────────────────
create table if not exists engagement_task_assignees (
  task_id uuid not null references engagement_tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists engagement_task_assignees_user_idx
  on engagement_task_assignees (user_id);
create index if not exists engagement_task_assignees_firm_idx
  on engagement_task_assignees (firm_id);

-- Carry over whatever 1340's single column holds.
insert into engagement_task_assignees (task_id, user_id, firm_id)
select t.id, t.assigned_user_id, t.firm_id
  from public.engagement_tasks t
 where t.assigned_user_id is not null
on conflict (task_id, user_id) do nothing;

alter table engagement_task_assignees enable row level security;

-- Follows the task, which follows the engagement — or, for a task with no
-- engagement, the client. Written as a lookup on the parent row rather than a
-- copy of its rule, so there is one place that decides and this cannot drift
-- from it.
drop policy if exists engagement_task_assignees_all on engagement_task_assignees;
create policy engagement_task_assignees_all on engagement_task_assignees for all
  using (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from public.engagement_tasks t
       where t.id = task_id and t.firm_id = public.current_firm_id()
    )
  )
  with check (firm_id = public.current_firm_id());

revoke all on engagement_task_assignees from anon;
grant select, insert, update, delete on engagement_task_assignees to authenticated;

-- ── the task's own policy has to cope with a null engagement ───────────────
-- 1340 gated purely on engagement_is_private(engagement_id). With no
-- engagement that returns false — which would make a client-only task visible
-- to the whole firm regardless of who is on the client. So the null case falls
-- through to the CLIENT's rule instead, which is the same one clients_all uses.
drop policy if exists engagement_tasks_all on engagement_tasks;
create policy engagement_tasks_all on engagement_tasks for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        engagement_id is not null
        and not public.engagement_is_private(engagement_id)
      )
      or (
        engagement_id is null
        and (
          public.client_assigned_to_me(client_id)
          or public.client_has_member(client_id)
        )
      )
    )
  )
  with check (firm_id = public.current_firm_id());

comment on policy engagement_tasks_all on public.engagement_tasks is
  'Firm-scoped. A task attached to a JOB follows that job''s visibility; a task attached only to a CLIENT follows the client''s list (client_members). Owners see everything.';

-- Verify after applying:
--
--   -- 1. shape:
--   select count(*) from engagement_tasks where client_id is null;   --> 0
--   select count(*) from engagement_task_assignees;                  --> 0
--
--   -- 2. the case this migration exists for — a task with no job:
--   insert into engagement_tasks (firm_id, client_id, title)
--   values ('<firm>', '<client>', 'Call CRA about the notice');
--   --> succeeds. Before this migration it fails on a null engagement_id.
--
--   -- 3. and the leak it would be if the policy above were wrong: as a STAFF
--   --    member who is NOT on that client, the row must not be visible.
