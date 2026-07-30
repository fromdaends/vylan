-- CUSTOM FOLDERS — real folders the firm owns, instead of derived ones.
--
-- Until now a "folder" in Files was not a folder. It was computed from what was
-- on each document — its year and its category — which is why it could not be
-- created, renamed or emptied: there was no row to rename. That mirrored the
-- filing engine's template exactly, which was the point.
--
-- The founder's call: "it is their files. It's the accountant's file. It's not
-- ours. They get to decide what they wanna do with it." So folders become real.
--
-- WHAT SURVIVES: the derived year/category view. A document that has not been
-- filed into a custom folder still appears exactly where it does today, so
-- nothing a firm already relies on disappears the moment this ships. Custom
-- folders sit alongside; documents move into them by hand.
--
-- WHAT DOES NOT CHANGE HERE: the filing engine still writes
-- Clients/{client}/{year}/{category} into the firm's cloud storage. Making
-- Drive mirror these folders instead is a separate, opt-in change (the firm
-- picks in Filing settings) and is deliberately not bundled into a migration
-- that only adds tables.
--
-- Additive + reversible. Down:
--   alter table uploaded_files drop column if exists folder_id; (and the other two)
--   drop table if exists document_folders;

-- ── The folder tree ────────────────────────────────────────────────────────
--
-- Scoped per CLIENT, because that is the top level of the browser and the unit
-- a firm actually thinks in. parent_id null = a folder at the root of that
-- client, sitting beside the derived year folders.
create table if not exists document_folders (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- CASCADE: deleting a parent hard-removes its descendants. The app never
  -- does that — it re-parents children upward first — but if a client row is
  -- ever purged, its whole tree must go with it rather than dangle.
  parent_id uuid references document_folders(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists document_folders_client_idx
  on document_folders (client_id, parent_id)
  where deleted_at is null;

create index if not exists document_folders_firm_idx
  on document_folders (firm_id)
  where deleted_at is null;

-- No two live siblings with the same name — the thing every file manager
-- enforces, and without which "move to Reports" becomes ambiguous.
--
-- TWO indexes because parent_id is nullable and NULLs never compare equal in a
-- unique index: a single index would happily allow twenty root folders all
-- called "Reports". The first covers root folders, the second covers nested
-- ones. lower(btrim(name)) so "Reports" and "reports " collide, which is what a
-- person means by "same name".
create unique index if not exists document_folders_unique_root
  on document_folders (client_id, lower(btrim(name)))
  where deleted_at is null and parent_id is null;

create unique index if not exists document_folders_unique_child
  on document_folders (client_id, parent_id, lower(btrim(name)))
  where deleted_at is null and parent_id is not null;

alter table document_folders enable row level security;

-- The clients_all shape (0810), plus the deleted_at exclusion 1090 established
-- for documents. A private client's folder structure is as private as their
-- documents.
drop policy if exists document_folders_all on document_folders;
create policy document_folders_all on document_folders for all
  using (
    deleted_at is null
    and firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  );

revoke all on document_folders from anon, authenticated;
grant select, insert, update on document_folders to authenticated;

-- ── Documents point at a folder ────────────────────────────────────────────
--
-- NULL = not filed by hand, so the document keeps appearing under its derived
-- year/category folder. That is what makes this additive rather than a
-- migration of everyone's structure on day one.
--
-- ON DELETE SET NULL: if a folder is ever hard-removed, its documents return to
-- the derived view rather than vanishing into a dangling reference. A document
-- must never become unreachable because a folder went away.
alter table uploaded_files
  add column if not exists folder_id uuid references document_folders(id) on delete set null;
alter table final_documents
  add column if not exists folder_id uuid references document_folders(id) on delete set null;
alter table imported_documents
  add column if not exists folder_id uuid references document_folders(id) on delete set null;

create index if not exists uploaded_files_folder_idx
  on uploaded_files (folder_id) where folder_id is not null and deleted_at is null;
create index if not exists final_documents_folder_idx
  on final_documents (folder_id) where folder_id is not null and deleted_at is null;
create index if not exists imported_documents_folder_idx
  on imported_documents (folder_id) where folder_id is not null and deleted_at is null;

-- ── The browsing view gains folder_id ──────────────────────────────────────
--
-- Recreated in full rather than patched: `create or replace view` cannot add a
-- column in the middle, and the column list must stay in one place or the three
-- union arms drift. This is byte-identical to 1070's definition plus folder_id.
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
  uf.folder_id                     as folder_id
from public.uploaded_files uf
join public.engagements e on e.id = uf.engagement_id

union all

select
  'final'::text, fd.id, fd.firm_id, e.client_id, fd.engagement_id,
  fd.storage_path, fd.original_filename, fd.display_name, fd.mime_type,
  fd.size_bytes, null::text, null::text, null::numeric, fd.manual_doc_type,
  fd.browse_year, fd.browse_category, null::text, false,
  fd.deleted_at, fd.deleted_by_user_id, fd.created_at, fd.folder_id
from public.final_documents fd
join public.engagements e on e.id = fd.engagement_id

union all

select
  'imported'::text, im.id, im.firm_id, im.client_id, null::uuid,
  im.storage_path, im.original_filename, im.display_name, im.mime_type,
  im.size_bytes, im.content_hash, null::text, null::numeric, im.manual_doc_type,
  im.browse_year, im.browse_category, null::text, false,
  im.deleted_at, im.deleted_by_user_id, im.created_at, im.folder_id
from public.imported_documents im;

grant select on public.firm_documents to authenticated;
