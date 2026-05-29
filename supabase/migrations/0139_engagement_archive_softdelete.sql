-- Engagement lifecycle: archive + 30-day soft-delete.
--
-- This is accounting software — nothing is hard-deleted straight from the UI.
--   * archive:      hide from active views; recoverable anytime; never purged.
--   * soft-delete:  set deleted_at; recoverable for 30 days; then the daily
--                   purge cron permanently removes the row AND its storage
--                   files (see src/app/api/cron/purge-deleted-engagements).
--
-- All four columns are nullable / default NULL, so every existing engagement
-- stays active (not archived, not deleted) after this migration runs.
--
-- No RLS/grant change needed: engagements UPDATE is already firm-scoped by
-- row-level RLS (0002_rls.sql) and is NOT column-locked (unlike users/firms in
-- 0039), so the app client writes these columns the same way it writes status
-- / completed_at today. Owner-vs-staff delete permission is enforced in the
-- server-action layer (see src/lib/engagements/lifecycle.ts: canDeleteEngagements).

alter table engagements
  add column archived_at timestamptz,
  add column archived_by_user_id uuid references users(id) on delete set null,
  add column deleted_at timestamptz,
  add column deleted_by_user_id uuid references users(id) on delete set null;

-- Partial indexes stay tiny (only the rare archived / deleted rows) and speed
-- the Archived + Recently Deleted views and the daily purge scan.
create index engagements_archived_at_idx
  on engagements (archived_at) where archived_at is not null;
create index engagements_deleted_at_idx
  on engagements (deleted_at) where deleted_at is not null;
