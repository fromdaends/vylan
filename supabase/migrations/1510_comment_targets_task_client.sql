-- Commenting becomes ONE system on FIVE things. file_comments already carried
-- three targets (0800 a FILE, 0930 a CHECKLIST ITEM and the ENGAGEMENT itself);
-- this adds a TASK and a CLIENT.
--
-- WHY NOT NEW TABLES. The founder's words: "i built a whole notion type
-- commenting feature... now its only on document collection checklist items...
-- make it so you can comment on specific tasks... Do the same thing for
-- engagements... change it to make the commenting system work the same on
-- adding notes for clients." Their complaint IS the fragmentation, so the fix
-- cannot be a fourth and fifth table. file_comments already owns the firm-scoped
-- RLS, the @mention array, the author denormalization and the delete-your-own
-- rule; a new target is one nullable FK and one arm on a CHECK. A second table
-- would mean re-implementing mentions, and mentions that work on a task but not
-- on a client is exactly the drift the cohesion rule in CLAUDE.md exists to stop.
--
-- ENGAGEMENT_ID BECOMES NULLABLE, and that is the load-bearing change. 1350 made
-- engagement_tasks.engagement_id nullable (a task belongs to a CLIENT; an
-- engagement is optional), so a task on the /work list can legitimately have no
-- engagement — and a comment on a CLIENT never has one. Leaving the column NOT
-- NULL would have silently made "comment on the main tasks view" impossible for
-- exactly the standalone tasks the founder asked about. A row must still be
-- anchored to SOMETHING, which the new file_comments_anchored CHECK enforces.
--
-- CLIENT NOTES ARE COPIED FORWARD, NOT MOVED. client_notes (1270) keeps every
-- row it has. Copying rather than moving means an unapplied-then-applied
-- migration cannot lose a note, and the reader falls back to client_notes while
-- this is still unapplied (repo rule: the code must degrade cleanly before the
-- SQL lands). The old table is left in place as the backup — per CLAUDE.md a
-- table is never dropped without asking.
--
-- GATED, per the repo's tiered pattern: isMissingFileCommentsSchema already
-- detects 42703/PGRST204 and the client-notes reader falls back, so this ships
-- with the code and applies on its own schedule (dev uses remote Supabase).
--
-- Migration number: highest on main is 1500 and the duplicate check
-- (ls supabase/migrations | sed 's/_.*//' | sort | uniq -d) printed nothing,
-- so 1510 is the next free one.

-- ── 1. The two new targets ────────────────────────────────────────────────
alter table file_comments
  add column if not exists engagement_task_id uuid
    references engagement_tasks(id) on delete cascade;

alter table file_comments
  add column if not exists client_id uuid
    references clients(id) on delete cascade;

-- ── 2. A comment need not hang off an engagement any more ─────────────────
alter table file_comments alter column engagement_id drop not null;

-- ── 3. One target, and never floating ─────────────────────────────────────
-- num_nonnulls(...) <= 1: a comment points at ONE thing, or at none — and none
-- still means "the engagement itself", which is how 0930 modelled it and why
-- that case must stay legal rather than being tightened to = 1.
alter table file_comments drop constraint if exists file_comments_one_target;
alter table file_comments add constraint file_comments_one_target
  check (
    num_nonnulls(uploaded_file_id, request_item_id, engagement_task_id, client_id) <= 1
  );

-- Every row is reachable from something the firm owns. Without this, dropping
-- the NOT NULL above would allow a row anchored to nothing at all, which no
-- reader would ever return and no RLS arm would ever constrain.
alter table file_comments drop constraint if exists file_comments_anchored;
alter table file_comments add constraint file_comments_anchored
  check (
    engagement_id is not null
    or engagement_task_id is not null
    or client_id is not null
  );

-- ── 4. The two new reads ──────────────────────────────────────────────────
create index if not exists file_comments_task_idx
  on file_comments (engagement_task_id, created_at);
create index if not exists file_comments_client_idx
  on file_comments (client_id, created_at);

-- ── 5. RLS ────────────────────────────────────────────────────────────────
-- SELECT gains the private-client cascade that client_notes (1270) already had:
-- a private client's comments are exactly as restricted as the knowledge that
-- the client exists. File / item / engagement comments are unaffected (client_id
-- is null there, so the first arm short-circuits) and keep the 0800 behaviour.
drop policy if exists file_comments_select on file_comments;
create policy file_comments_select on file_comments
  for select using (
    firm_id = public.current_firm_id()
    and (
      client_id is null
      or public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  );

-- INSERT: still only as yourself, into your own firm, and every anchor that IS
-- set must independently be one of your firm's. Each arm is written as
-- "<col> is null or exists(...)" so a comment on a task with no engagement is
-- allowed while a comment naming another firm's engagement is not.
drop policy if exists file_comments_insert on file_comments;
create policy file_comments_insert on file_comments
  for insert with check (
    firm_id = public.current_firm_id()
    and author_user_id = auth.uid()
    and (
      engagement_id is null
      or exists (
        select 1 from engagements e
        where e.id = engagement_id and e.firm_id = public.current_firm_id()
      )
    )
    and (
      engagement_task_id is null
      or exists (
        select 1 from engagement_tasks t
        where t.id = engagement_task_id and t.firm_id = public.current_firm_id()
      )
    )
    and (
      client_id is null
      or (
        exists (
          select 1 from clients c
          where c.id = client_id and c.firm_id = public.current_firm_id()
        )
        and (
          public.current_user_is_owner()
          or not public.client_is_private(client_id)
        )
      )
    )
  );

-- DELETE is unchanged from 0800 (author-only, own firm) and there is still NO
-- update path anywhere: a comment records what somebody said at a moment.

-- ── 6. Carry the existing client notes across ─────────────────────────────
-- Idempotent on purpose: re-running must not double a note. The guard matches
-- on the note's own identity (client + author + body + timestamp) rather than a
-- marker column, so it holds even if this block is replayed from scratch.
--
-- author_user_id is looked up through public.users rather than copied straight:
-- client_notes references auth.users while file_comments references users, and
-- an author with no users row must become NULL rather than fail the whole copy.
-- author_name is already denormalized on both sides, so the note stays readable
-- either way.
insert into file_comments (
  firm_id, engagement_id, uploaded_file_id, request_item_id,
  engagement_task_id, client_id,
  author_user_id, author_name, body, mentions, created_at
)
select
  n.firm_id, null, null, null,
  null, n.client_id,
  u.id, n.author_name, n.body, '{}'::uuid[], n.created_at
from client_notes n
left join users u on u.id = n.author_user_id
where not exists (
  select 1 from file_comments fc
  where fc.client_id = n.client_id
    and fc.body = n.body
    and fc.created_at = n.created_at
    and coalesce(fc.author_name, '') = coalesce(n.author_name, '')
);

comment on column file_comments.engagement_task_id is
  'The task this comment is on (1510). Null for every other target.';
comment on column file_comments.client_id is
  'The client this comment is on (1510) — the successor to client_notes. Null for every other target. Carries the private-client RLS cascade.';

-- Verify after applying:
--   select
--     count(*) filter (where client_id is not null)          as on_clients,
--     count(*) filter (where engagement_task_id is not null) as on_tasks,
--     count(*) filter (where request_item_id is not null)    as on_items,
--     count(*) filter (where uploaded_file_id is not null)   as on_files,
--     count(*) filter (where uploaded_file_id is null
--                        and request_item_id is null
--                        and engagement_task_id is null
--                        and client_id is null)              as on_engagements
--   from file_comments;
--
-- on_clients must equal `select count(*) from client_notes;` immediately after
-- this runs. on_tasks starts at 0 — nothing could write one before now.
