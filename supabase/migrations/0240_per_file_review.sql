-- Per-file review state (Phase 2 of the rejection loop).
--
-- WHAT: each uploaded file gets its OWN accountant decision, so a checklist item
-- with several files can have some approved and some rejected. The item's
-- request_items.status becomes a derived ROLL-UP of its files' review_status,
-- maintained in app code (recomputeItemStatus) on every write — so every
-- existing reader of request_items.status (dashboards, the client portal, the
-- progress ring) keeps working and simply becomes accurate.
--
-- SAFETY: additive + backfilled, so applying this changes nothing on its own.
-- The backfill copies the current item-level decision onto its files:
--   * item 'approved' -> its files become 'approved' (carry approved_by / _at)
--   * item 'rejected' -> its files become 'rejected' (carry the reason; stamp
--                        reviewed_at from the file's upload time, since the item
--                        row has no rejection timestamp)
--   * 'submitted' / 'pending' / 'na' -> files stay 'pending' (the default)
--
-- The existing `uploaded_files_all` RLS policy (0002_rls.sql) already scopes all
-- writes to the calling accountant's firm, so the new columns need no new policy.
--
-- REVERSIBLE. To revert:
--   drop index if exists uploaded_files_review_status_idx;
--   alter table uploaded_files
--     drop column if exists reviewed_at,
--     drop column if exists reviewed_by,
--     drop column if exists rejection_reason,
--     drop column if exists review_status;
--   drop type if exists file_review_status;

create type file_review_status as enum ('pending', 'approved', 'rejected');

alter table uploaded_files
  add column review_status file_review_status not null default 'pending',
  add column rejection_reason text,
  add column reviewed_by uuid references users(id) on delete set null,
  add column reviewed_at timestamptz;

-- Backfill approved items -> approved files.
update uploaded_files f
set review_status = 'approved',
    reviewed_by = i.approved_by,
    reviewed_at = coalesce(i.approved_at, now())
from request_items i
where f.request_item_id = i.id
  and i.status = 'approved';

-- Backfill rejected items -> rejected files (carry the single item-level reason
-- onto each file; stamp reviewed_at from the upload time as a proxy).
update uploaded_files f
set review_status = 'rejected',
    rejection_reason = i.rejection_reason,
    reviewed_at = f.uploaded_at
from request_items i
where f.request_item_id = i.id
  and i.status = 'rejected';

create index uploaded_files_review_status_idx
  on uploaded_files (request_item_id, review_status);
