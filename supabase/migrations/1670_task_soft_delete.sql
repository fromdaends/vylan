-- Tasks get a recycle bin — the same 30-day window engagements have had since
-- 0139.
--
-- ⚠️ THIS CLOSES A HAZARD I OPENED. Bulk delete on the tasks list (#1369) is
-- immediate and permanent: tick twelve rows, hit Delete, and they are gone with
-- no undo. Engagements have never worked that way — 0139 opens with "This is
-- accounting software — nothing is hard-deleted straight from the UI" — and a
-- task carries the same evidence of what a firm did and when.
--
-- The founder, asked whether to match engagements: "yeah do #2". Deliberately
-- NOT archive-as-well. An engagement is archived because the JOB is finished
-- with; a task is either live or it is a mistake, and inventing a second shelf
-- nobody asked for is how a list grows tabs that never get clicked.
--
-- SHAPE COPIED FROM 0139, on purpose: same column names, same partial index,
-- same 30-day retention, so the purge cron and every "is this really gone"
-- question have one answer across both objects.
--
-- WHY NO deleted_by BACKFILL CONCERN: both columns are nullable and default
-- NULL, so every existing task stays live the moment this runs.
--
-- ⚠️ THE READERS MUST FILTER. A soft-delete column that readers ignore is worse
-- than a hard delete: the row comes back on every list looking alive. The
-- accompanying code change adds `deleted_at is null` to the task readers, and
-- the tasks list gains a Recently deleted view — a bin nobody can open is not
-- a recovery window.
--
-- Migration number: RENUMBERED FROM 1650 — the FOURTH collision this session.
-- 1640 was the highest when this was written; #1382 and #1384 merged 1650 and
-- 1660 while it was in progress. The window that keeps catching people is
-- between opening a PR and it merging, which is why the check has to run
-- immediately before merge and not only at creation.
--   ls supabase/migrations | sed 's/_.*//' | sort | uniq -d
-- 1670 is next, and src/lib/db/migrations.test.ts fails the suite if this ever
-- slips through again.

alter table public.engagement_tasks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid
    references public.users(id) on delete set null;

-- Partial: only the rare deleted rows, so it stays tiny and still serves both
-- the Recently deleted view and the daily purge scan.
create index if not exists engagement_tasks_deleted_at_idx
  on public.engagement_tasks (deleted_at) where deleted_at is not null;

comment on column public.engagement_tasks.deleted_at is
  'Soft delete (1670). Non-null means the task is in the 30-day recycle bin and must be excluded from every live read; the purge cron removes it permanently after that. Mirrors engagements.deleted_at (0139).';

-- Verify after applying — expect 0 until something is deleted:
--   select count(*) as in_the_bin from engagement_tasks where deleted_at is not null;
