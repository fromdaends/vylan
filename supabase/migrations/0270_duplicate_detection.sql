-- Auto-reject (or flag) DUPLICATE document uploads.
--
-- Phase 1 (this migration): schema only. A firm setting that is INDEPENDENT of
-- auto_reject_unusable_docs (0029) — they are separate toggles — plus the
-- per-upload content fingerprint used to detect a byte-identical re-upload
-- within the same engagement, and the columns that persist a detected
-- duplicate (so the "off = flag" path survives a reload and the UI can show a
-- badge). Phase 2 fills the fingerprint + detection + routing; Phase 3 adds the
-- Settings toggle. Everything here is additive + idempotent; no existing row is
-- mutated and every column has a safe default.

-- Firm-level opt-in, SEPARATE from auto_reject_unusable_docs. Default false so
-- existing firms are unchanged until they turn it on (matches the unusable-docs
-- setting). When ON a detected duplicate is auto-rejected + the client is told;
-- when OFF the duplicate is only flagged for the accountant's review.
alter table firms
  add column if not exists auto_reject_duplicates boolean not null default false;

-- Per-upload content fingerprint: SHA-256 hex of the STORED bytes. Lets us spot
-- a byte-identical re-upload in the same engagement without re-downloading every
-- file. Nullable: legacy rows + any upload created before this ships have none
-- (treated as "no fingerprint" = never matches, so they're never flagged).
alter table uploaded_files
  add column if not exists content_hash text;

-- A detected duplicate is marked here so the flag PERSISTS (the off-setting path
-- flags rather than rejects, and the badge must survive a reload without
-- re-detecting). duplicate_of_file_id points at the EARLIER upload it
-- duplicates (the later upload is the one marked); SET NULL if that earlier
-- file is ever deleted.
alter table uploaded_files
  add column if not exists is_duplicate boolean not null default false;
alter table uploaded_files
  add column if not exists duplicate_of_file_id uuid
    references uploaded_files(id) on delete set null;

-- Fast duplicate lookup: "is there another file in THIS engagement with the
-- same fingerprint?" Partial index skips the many legacy/null-hash rows.
create index if not exists uploaded_files_engagement_hash_idx
  on uploaded_files(engagement_id, content_hash)
  where content_hash is not null;

-- firms has a COLUMN-LEVEL update whitelist (0039_lock_down_column_updates):
-- authenticated members may only UPDATE the listed columns, else PostgREST
-- raises "permission denied for column ...". The Settings toggle writes this
-- new column through the RLS-scoped session client, so it must be granted.
-- Column grants are cumulative, so this adds just the one new column to the
-- existing whitelist (the service-role AI worker already bypasses this).
grant update (auto_reject_duplicates) on public.firms to authenticated;
