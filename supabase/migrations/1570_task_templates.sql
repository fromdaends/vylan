-- TASK TEMPLATES — a named set of tasks, saved and dropped into work.
--
-- Canopy's third kind of template, and the one Vylan was missing. The founder:
-- "The creation of task templates outside of just engagement creation needs to
-- be done", and then: "we gotta do the same for task templates... which we
-- gotta build too."
--
-- ── WHY A SEPARATE TABLE AND NOT A FLAG ON engagement_templates ────────────
--
-- Because they answer different questions and are picked at different moments.
-- An ENGAGEMENT template answers "what kind of job is this" and is chosen once,
-- at the start, INSTEAD of starting from scratch. A TASK template answers "what
-- steps does this piece of work take" and is chosen DURING, as many times as
-- you like, and can be applied to an engagement that already exists.
--
-- A `kind` column on one table would mean every reader has to remember to
-- filter, and the day one forgets, engagement templates appear in the task
-- picker. Two tables cannot make that mistake.
--
-- ── WHY jsonb, AGAIN ───────────────────────────────────────────────────────
--
-- Same reasoning as 1500, and the same trade. A task carries a title and a kind
-- today; Canopy's own task templates also carry subtasks, durations and
-- relative due dates, and every one of those would otherwise be a migration
-- here. Nothing in the database validates the payload, so the READER treats
-- every field as optional and unknown-shaped. It does.
--
-- ── WHAT IT DELIBERATELY DOES NOT STORE ────────────────────────────────────
--
-- Assignees. A template is a shape of work, not a roster: the person who does
-- "Prepare the file" is different on every job, and a template that carried
-- last quarter's assignee would quietly hand new work to the wrong person. They
-- are chosen when the tasks are actually created.
--
-- Nor an engagement_id — the whole point is that it is reusable.

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,

  name text not null,

  -- Mirrors engagement_templates.access exactly:
  --   team    — everyone in the firm can use and edit it
  --   private — only the person who made it
  -- Enforced in RLS below, not merely in the UI.
  access text not null default 'team'
    check (access in ('team', 'private')),

  -- { "tasks": [ { "title": "...", "kind": "review" }, ... ] }
  -- Read defensively — a template saved today will be read by a build that has
  -- grown new task fields.
  payload jsonb not null default '{}'::jsonb,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id) on delete set null
);

create index if not exists task_templates_firm_idx
  on public.task_templates (firm_id, created_at desc);
-- Pickers only ever ask for the live ones.
create index if not exists task_templates_live_idx
  on public.task_templates (firm_id) where archived_at is null;

alter table public.task_templates enable row level security;

do $$
begin
  -- SELECT carries the private rule. A private template is invisible to the
  -- rest of the firm at the DATABASE, not just hidden in a dropdown — otherwise
  -- "private" is a label rather than a guarantee.
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'task_templates'
      and policyname = 'task_templates_select'
  ) then
    create policy task_templates_select on public.task_templates
      for select using (
        firm_id in (select firm_id from public.users where id = auth.uid())
        and (access = 'team' or created_by_user_id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'task_templates'
      and policyname = 'task_templates_insert'
  ) then
    create policy task_templates_insert on public.task_templates
      for insert with check (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'task_templates'
      and policyname = 'task_templates_update'
  ) then
    create policy task_templates_update on public.task_templates
      for update using (
        firm_id in (select firm_id from public.users where id = auth.uid())
        and (access = 'team' or created_by_user_id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'task_templates'
      and policyname = 'task_templates_delete'
  ) then
    create policy task_templates_delete on public.task_templates
      for delete using (
        firm_id in (select firm_id from public.users where id = auth.uid())
        and (access = 'team' or created_by_user_id = auth.uid())
      );
  end if;
end $$;

comment on table public.task_templates is
  'A named set of tasks, saved for reuse and applied to work that already exists. Distinct from engagement_templates (a whole job, chosen at the start) and from templates (document requests). Payload is jsonb for the same reason as 1500: task fields are still growing.';
comment on column public.task_templates.access is
  'team = the whole firm may use and edit it; private = its creator only. Enforced in RLS, not just the UI.';
comment on column public.task_templates.payload is
  'Shape: { "tasks": [ { "title": string, "kind": string } ] }. Deliberately carries NO assignees — a template is a shape of work, not a roster.';
