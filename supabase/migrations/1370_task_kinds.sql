-- A task has a KIND, and an engagement's list starts empty.
--
-- The founder, looking at the three hardcoded rows I shipped an hour earlier:
--
--   "it should be, like, empty... it shouldn't be, like, a fill out, like, do
--    these three tasks. It should be empty until the user goes and creates a
--    task... and then that'll be prompted like, what kind of task are you
--    trying to create?"
--
-- Right, and the difference is between a list and a form. Checklist /
-- Signatures / Deliverables were three VIEWS of one engagement rendered as
-- rows — they appeared on every job whether or not anybody wanted them. After
-- this they are things you made, and a job with none of them shows none.
--
-- Confirmed against Canopy's own documentation before writing this: their
-- engagement carries a "Manage Tasks" tab where you "click a task name to open
-- its workspace" and "click + Add task to add additional tasks".
--
-- ── THE KINDS, and why only four ────────────────────────────────────────────
--
--   document_collection  asks the client for files. Opens today's checklist.
--   signatures           sends documents out to be signed.
--   deliverables         hands finished work back.
--   task                 a thing somebody does. No screen; a row is all of it.
--
-- Canopy also has Questionnaire, Notice and Client Request. Those are not here
-- because Vylan has no machinery behind them, and a kind whose screen does not
-- exist is a menu option that leads nowhere.
--
-- ── ONE OF EACH BUILT-IN KIND PER ENGAGEMENT, for now ───────────────────────
--
-- A document_collection task drives the engagement's request_items, and it
-- finds them by engagement_id. With two such tasks on one job that lookup is
-- ambiguous — both would show the same documents.
--
-- So a partial unique index enforces one per kind, and step 2 is what relaxes
-- it (by giving request_items a task_id of their own). Plain tasks are
-- unlimited: they own nothing, so nothing is ambiguous about them.
--
-- ⚠️ NOTHING MOVES. request_items and final_documents stay exactly where they
-- are, still keyed by engagement_id, still read by the client portal, the AI
-- classifier, the filing engine and ten RLS policies. The task POINTS AT them.
-- If this ever becomes "copy the items onto the task", that is the moment to
-- stop — that version breaks the portal for every client at once.
--
-- Idempotent throughout. Safe to run twice.

-- ── the kind ───────────────────────────────────────────────────────────────
alter table public.engagement_tasks
  add column if not exists kind text not null default 'task';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'engagement_tasks_kind_check'
  ) then
    alter table public.engagement_tasks
      add constraint engagement_tasks_kind_check
      check (kind in ('task', 'document_collection', 'signatures', 'deliverables'));
  end if;
end $$;

comment on column public.engagement_tasks.kind is
  'What sort of work this is, and therefore which screen it opens. ''task'' has no screen — a row is all of it. The other three POINT AT collections that live elsewhere (request_items, final_documents) and never copy them.';

-- One document collection per job, one signatures, one deliverables. Plain
-- tasks are unlimited — they own no collection, so nothing is ambiguous.
create unique index if not exists engagement_tasks_one_per_kind_idx
  on public.engagement_tasks (engagement_id, kind)
  where kind <> 'task' and engagement_id is not null;

-- ── backfill: every existing job gets the tasks it actually has ────────────
-- Not three each. A job with no signature items does not get a Signatures task
-- sitting at zero of zero, which is the exact noise this migration removes.

-- Document collection: every engagement has a checklist, even an empty one —
-- it is what the job IS today, so every job gets this row.
insert into public.engagement_tasks
  (engagement_id, client_id, firm_id, title, kind, status, order_index)
select e.id, e.client_id, e.firm_id, 'Document collection', 'document_collection',
       -- ⚠️ THE CAST IS LOAD-BEARING. status is engagement_task_status (an enum,
       -- from 1340), and a CASE resolves to TEXT — which Postgres will not
       -- implicitly coerce into an enum column. Without it the whole migration
       -- aborts on this statement with 42804. A bare literal like 'doing' below
       -- gets away with it because an untyped literal is `unknown` and coerces
       -- fine; a CASE does not. Found by running it against the real database,
       -- which is the only place this repo's SQL ever runs before production.
       (case
         -- Already finished collecting: mark it done rather than leaving a
         -- completed job showing an open task. 'complete' and 'cancelled' are
         -- the two terminal values of engagement_status — checked against the
         -- enum in 0001 rather than guessed, because a status that matches
         -- nothing fails silently and leaves every finished job showing work
         -- in progress.
         when e.status in ('complete', 'cancelled') then 'done'
         else 'doing'
       end)::engagement_task_status,
       0
  from public.engagements e
 where not exists (
   select 1 from public.engagement_tasks t
    where t.engagement_id = e.id and t.kind = 'document_collection'
 )
on conflict do nothing;

-- Signatures: only where signature items exist.
insert into public.engagement_tasks
  (engagement_id, client_id, firm_id, title, kind, status, order_index)
select e.id, e.client_id, e.firm_id, 'Signatures', 'signatures',
       'doing'::engagement_task_status, 1
  from public.engagements e
 where exists (
   select 1 from public.request_items ri
    where ri.engagement_id = e.id and ri.kind = 'signature'
 )
   and not exists (
   select 1 from public.engagement_tasks t
    where t.engagement_id = e.id and t.kind = 'signatures'
 )
on conflict do nothing;

-- Deliverables: only where something has actually been delivered.
insert into public.engagement_tasks
  (engagement_id, client_id, firm_id, title, kind, status, order_index)
select e.id, e.client_id, e.firm_id, 'Deliverables', 'deliverables',
       'doing'::engagement_task_status, 2
  from public.engagements e
 where exists (
   select 1 from public.final_documents fd where fd.engagement_id = e.id
 )
   and not exists (
   select 1 from public.engagement_tasks t
    where t.engagement_id = e.id and t.kind = 'deliverables'
 )
on conflict do nothing;

-- Verify after applying:
--
--   -- 1. one document collection per job, and no job left without one:
--   select count(*) from engagements;                                  --> N
--   select count(*) from engagement_tasks where kind='document_collection'; --> N
--
--   -- 2. signatures and deliverables only where they are real:
--   select kind, count(*) from engagement_tasks group by kind;
--   --> signatures and deliverables should BOTH be fewer than N. If either
--       equals N the "only where they exist" clause did not filter, and every
--       job has picked up an empty task — which is the thing this replaces.
--
--   -- 3. nothing moved:
--   select count(*) from request_items;   --> unchanged from before
--   select count(*) from final_documents; --> unchanged from before
