-- Statuses the FIRM defines.
--
-- The founder: "We need more kinds of statuses, for example, canopy has all
-- kinds of different ones for ultra specific situations, especially because we
-- intend to implement AI workflow automation into the tasks. And it'll be nice
-- to have labels for them. Compared to our only 3 for the moment."
--
-- I looked it up before building, on their instruction, and the research
-- reversed the obvious plan. Canopy's own help centre carries an "Add custom
-- status" button: their answer to "more statuses" is not a longer hardcoded
-- list, it is statuses the firm creates. So adding six more fixed values would
-- have been work to undo.
--
-- ── THE SHAPE, AND WHY THE OLD COLUMN SURVIVES ─────────────────────────────
--
-- Every status belongs to a BUCKET — todo / doing / done — and engagement_tasks
-- keeps its existing `status` enum as exactly that bucket. A firm's "Needs
-- review" is a doing; their "With client" is a doing; "Filed" is a done.
--
-- This is the whole design and it is the reason nothing breaks. Progress bars,
-- the Active-work view, the status filter, the sort order and the completion
-- rules all read the BUCKET, which still has three stable values. Only the
-- LABEL and the COLOUR become the firm's. It is how Linear and Jira do it, and
-- for the same reason: unlimited names are a UI problem, unlimited states are a
-- logic problem.
--
-- A TRIGGER keeps the two honest. Setting status_id rewrites `status` from that
-- status's bucket, so the enum can never disagree with the label a user sees —
-- which is the failure mode of every "denormalised for convenience" column.
--
-- ── WHO MAY EDIT THEM ──────────────────────────────────────────────────────
--
-- Read: the whole firm, because every task row renders one.
-- Write: the OWNER only. This is not the same call as engagement_tasks (1340,
-- everyone) or firm_links (1410, everyone): those are shared shelves, and a
-- status list is the vocabulary the whole board speaks. One person renaming
-- "Done" mid-season changes what every other person's screen means.
--
-- ── SEEDING ────────────────────────────────────────────────────────────────
--
-- Every existing firm gets exactly the three it has today, so applying this
-- changes nothing anybody can see. Only if the firm has none at all, so
-- re-running never duplicates and never resurrects one somebody deleted.
--
-- ⚠️ No enum is created and none is written by a CASE. 1370 aborted because a
-- CASE resolves to TEXT and will not coerce into an enum column; the bucket
-- here is a plain text column with a check constraint, which has no such trap.
--
-- Idempotent throughout. Safe to run twice.

create table if not exists task_statuses (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  name text not null,
  -- A hex the UI renders directly. Free text rather than an enum of allowed
  -- swatches: the firm picks, and constraining it buys nothing.
  color text not null default '#64748b',
  -- WHICH OF THE THREE REAL STATES THIS MEANS. Everything in the product that
  -- reasons about progress reads this, never the name.
  bucket text not null default 'todo',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_statuses_bucket_check'
  ) then
    alter table public.task_statuses
      add constraint task_statuses_bucket_check
      check (bucket in ('todo', 'doing', 'done'));
  end if;
end $$;

-- Two statuses in one firm may not share a name: the whole point is that the
-- name is what people say to each other.
create unique index if not exists task_statuses_firm_name_idx
  on public.task_statuses (firm_id, lower(name));
create index if not exists task_statuses_firm_sort_idx
  on public.task_statuses (firm_id, bucket, sort);

alter table public.task_statuses enable row level security;

-- Read: the whole firm. Write: the owner. See the note above for why this
-- differs from engagement_tasks.
drop policy if exists task_statuses_select on public.task_statuses;
create policy task_statuses_select on public.task_statuses for select
  using (firm_id = public.current_firm_id());

drop policy if exists task_statuses_write on public.task_statuses;
create policy task_statuses_write on public.task_statuses for all
  using (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from public.users u
       where u.id = auth.uid() and u.role = 'owner'
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from public.users u
       where u.id = auth.uid() and u.role = 'owner'
    )
  );

revoke all on public.task_statuses from anon;
grant select, insert, update, delete on public.task_statuses to authenticated;

-- ── the link from a task ───────────────────────────────────────────────────
-- Nullable, and ON DELETE SET NULL: losing a status must never lose the task.
-- A task with no status_id falls back to its bucket's default label, so it
-- keeps rendering rather than going blank.
alter table public.engagement_tasks
  add column if not exists status_id uuid references public.task_statuses(id) on delete set null;

create index if not exists engagement_tasks_status_id_idx
  on public.engagement_tasks (status_id)
  where status_id is not null;

-- ── the trigger that keeps the bucket honest ───────────────────────────────
create or replace function public.sync_task_status_bucket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b text;
begin
  if new.status_id is not null then
    select bucket into b from public.task_statuses where id = new.status_id;
    -- A status from another firm, or one deleted mid-write, leaves the enum
    -- alone rather than nulling it: the task keeps whatever state it had.
    if b is not null then
      new.status := b::engagement_task_status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists engagement_tasks_sync_status on public.engagement_tasks;
create trigger engagement_tasks_sync_status
  before insert or update of status_id on public.engagement_tasks
  for each row execute function public.sync_task_status_bucket();

-- ── seed: exactly what every firm already has ──────────────────────────────
insert into public.task_statuses (firm_id, name, color, bucket, sort)
select f.id, seed.name, seed.color, seed.bucket, seed.sort
from public.firms f
cross join (
  values
    ('To do',       '#64748b', 'todo',  0),
    ('In progress', '#2563eb', 'doing', 10),
    ('Done',        '#16a34a', 'done',  20)
) as seed(name, color, bucket, sort)
where not exists (
  select 1 from public.task_statuses s where s.firm_id = f.id
);

-- Point every existing task at its firm's matching seeded status, so the board
-- reads identically the moment this lands. Matched on the BUCKET, not the name:
-- a firm that has already renamed "Done" still gets the right row.
update public.engagement_tasks t
   set status_id = s.id
  from public.task_statuses s
 where s.firm_id = t.firm_id
   and s.bucket = t.status::text
   and t.status_id is null;

comment on table public.task_statuses is
  'Task statuses the FIRM names and colours. Every one belongs to a bucket (todo/doing/done) and engagement_tasks.status holds that bucket — a trigger rewrites it whenever status_id changes, so the enum can never disagree with the label. Everything that reasons about progress reads the BUCKET; only the label and colour are the firm''s. Read: whole firm. Write: owner only.';

-- Verify after applying:
--
--   select count(*) from firms;                      --> N
--   select count(*) from task_statuses;              --> 3 × N
--   select count(*) from engagement_tasks where status_id is null;   --> 0
--
--   -- and the trigger holds the two in step:
--   select t.status, s.bucket from engagement_tasks t
--     join task_statuses s on s.id = t.status_id
--    where t.status::text <> s.bucket;               --> no rows, ever
