-- DOCUMENT VISIBILITY — client-visible vs firm-only (Files v2 §6).
--
-- Two states on every document:
--   'client' — the client may see it where the portal already shows it
--              (their own uploads, deliverables shared to them).
--   'firm'   — working papers, internal notes, anything the team keeps to
--              itself. Must never appear in ANY client-facing surface, and
--              the portal routes enforce that at the query layer, not the UI.
--
-- Defaults follow provenance:
--   uploaded_files   'client' — the client sent it; hiding their own upload
--                               from them is an explicit act, never a default.
--   final_documents  'client' — deliverables exist to be shared.
--   imported_documents 'firm' — a migration dump may contain anything, so the
--                               safe default is private until explicitly
--                               shared. ADD COLUMN ... DEFAULT backfills the
--                               existing rows with the same value, which is
--                               exactly the intended retrofit.
--
-- This flag is the PREREQUISITE for a future "share from Files" feature —
-- the flag ships now, the sharing does not.

alter table uploaded_files
  add column if not exists visibility text not null default 'client'
  check (visibility in ('client', 'firm'));
alter table final_documents
  add column if not exists visibility text not null default 'client'
  check (visibility in ('client', 'firm'));
alter table imported_documents
  add column if not exists visibility text not null default 'firm'
  check (visibility in ('client', 'firm'));

-- ── The browsing view gains visibility ─────────────────────────────────────
-- Recreated in full, same rule as 1100: the column list lives in one place or
-- the three union arms drift. Byte-identical to 1100's definition plus the
-- visibility column in each arm.
create or replace view public.firm_documents
  with (security_invoker = true) as
select
  'checklist'::text                as source,
  uf.id                            as id,
  e.firm_id                        as firm_id,
  e.client_id                      as client_id,
  uf.engagement_id                 as engagement_id,
  uf.storage_path                  as storage_path,
  uf.original_filename             as original_filename,
  uf.display_name                  as display_name,
  uf.mime_type                     as mime_type,
  uf.size_bytes                    as size_bytes,
  uf.content_hash                  as content_hash,
  uf.ai_classification             as ai_doc_type,
  uf.ai_confidence                 as ai_confidence,
  uf.manual_doc_type               as manual_doc_type,
  uf.browse_year                   as browse_year,
  uf.browse_category               as browse_category,
  uf.review_status::text           as review_status,
  uf.is_duplicate                  as is_duplicate,
  uf.deleted_at                    as deleted_at,
  uf.deleted_by_user_id            as deleted_by_user_id,
  uf.uploaded_at                   as created_at,
  uf.folder_id                     as folder_id,
  uf.visibility                    as visibility
from public.uploaded_files uf
join public.engagements e on e.id = uf.engagement_id

union all

select
  'final'::text, fd.id, fd.firm_id, e.client_id, fd.engagement_id,
  fd.storage_path, fd.original_filename, fd.display_name, fd.mime_type,
  fd.size_bytes, null::text, null::text, null::numeric, fd.manual_doc_type,
  fd.browse_year, fd.browse_category, null::text, false,
  fd.deleted_at, fd.deleted_by_user_id, fd.created_at, fd.folder_id,
  fd.visibility
from public.final_documents fd
join public.engagements e on e.id = fd.engagement_id

union all

select
  'imported'::text, im.id, im.firm_id, im.client_id, null::uuid,
  im.storage_path, im.original_filename, im.display_name, im.mime_type,
  im.size_bytes, im.content_hash, null::text, null::numeric, im.manual_doc_type,
  im.browse_year, im.browse_category, null::text, false,
  im.deleted_at, im.deleted_by_user_id, im.created_at, im.folder_id,
  im.visibility
from public.imported_documents im;

grant select on public.firm_documents to authenticated;
