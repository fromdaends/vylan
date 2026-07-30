-- FILES SECTION — schema for the firm-wide document browser.
--
-- The Files section is a NEW SURFACE OVER EXISTING DATA, not a new pipeline.
-- Documents keep arriving exactly as they do today (engagements + client
-- portal); this migration adds the three things Browse needs and today's schema
-- cannot express:
--
--   1. BROWSE AXES on every document. The drill-down is
--      Clients/{client}/{year}/{category} — the firm's default folder template
--      — but NEITHER axis is stored anywhere today. Both are computed in
--      TypeScript at filing time (resolveYear's chain in lib/filing/tokens.ts,
--      and the doc type's GROUP from lib/doc-types.ts, gated on confidence
--      >= 0.5). Computed values cannot be filtered, grouped, sorted or PAGED in
--      SQL, and "Move this file to 2023" has nowhere to write. So both axes are
--      denormalized onto the row, each with a _manual flag so a later
--      re-classification can never silently undo a human's decision.
--
--   2. A RECYCLE BIN. uploaded_files has no soft delete — today's delete
--      (deleteUploadedFilePermanently) erases the row AND the storage object
--      outright. The spec requires a 30-day recoverable window, so this copies
--      the engagements lifecycle pattern (0139): deleted_at + deleted_by_user_id,
--      a retention window enforced by the reader, and a purge cron.
--
--   3. IMPORTED DOCUMENTS. An imported file has no engagement and no checklist
--      item, and uploaded_files.request_item_id is NOT NULL with an ON DELETE
--      CASCADE from request_items — so an import structurally CANNOT be a row in
--      that table. Its own table is not a workaround, it is the guarantee: the
--      spec's hard rule "importing must never satisfy or affect a checklist
--      item" becomes true by construction rather than by discipline. It is also
--      what makes imports filing-exempt for free — the filing runner only ever
--      reads uploaded_files + final_documents for a given engagement, so an
--      imported document can never be pushed back out to the cloud storage it
--      came from.
--
-- Plus a firm_documents VIEW unioning the three sources into one shape, so the
-- browser's filter/sort/search/paginate is a single SQL query over one relation
-- instead of three round-trips and an in-memory merge.
--
-- GATED like every post-launch table (dev + previews point at the prod DB): all
-- readers treat a missing table/column/view as "Files not set up yet" via
-- error-code checks only (the 0650 rule), so the app behaves exactly as today
-- until this file is applied.
--
-- Additive + reversible. Down:
--   drop view if exists firm_documents;
--   drop table if exists imported_documents;
--   drop table if exists document_import_runs;
--   alter table uploaded_files drop column if exists deleted_at, ... (etc);
--   alter table final_documents drop column if exists deleted_at, ... (etc);

-- ── 1. Browse axes + soft delete on uploaded_files ──────────────────────────
--
-- browse_year / browse_category are WRITTEN BY THE APP (the classify worker on
-- every classification, the Move action on every manual change) using the same
-- TypeScript that renders the filing tokens. They are deliberately NOT a
-- generated column or a SQL function: the doc-type -> group map lives in
-- lib/doc-types.ts, and a second copy in SQL would drift the first time a doc
-- type is added. NULL browse_category = the localized "Unsorted" bucket.
--
-- The _manual flags are the whole reason Move is safe. Without them, the next
-- re-classification of a file an accountant had hand-sorted would silently move
-- it back — the single most infuriating possible bug in a filing product.
alter table uploaded_files
  add column if not exists browse_year integer
    check (browse_year is null or (browse_year between 1990 and 2100)),
  add column if not exists browse_category text,
  add column if not exists browse_year_manual boolean not null default false,
  add column if not exists browse_category_manual boolean not null default false,
  -- Accountant-set document type, for files the AI never read (every imported
  -- file, by the founder's decision) or read wrongly. BROWSE-FACING ONLY in v1:
  -- it drives the type badge, the type filter and the derived category, and it
  -- deliberately does NOT feed the filing engine's naming — Move must not
  -- re-file (per spec), and filed_documents' partial unique index means an
  -- already-filed document keeps the cloud path it was filed under anyway.
  add column if not exists manual_doc_type text,
  -- When the axes above were last computed. NULL = never, which is exactly the
  -- state every pre-1070 row starts in — and that is what makes the backfill
  -- self-terminating and safe to run from the ordinary jobs cron instead of a
  -- one-shot script somebody has to remember to run with production
  -- credentials. It cannot be inferred from `browse_year is null`, because a
  -- document with no detectable year is legitimately null forever and would be
  -- rescanned on every sweep until the end of time.
  add column if not exists browse_axes_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references users(id) on delete set null;

-- The backfill sweep's claim query: the oldest documents that have never had
-- their axes computed. Partial, so it empties itself as the sweep progresses
-- and costs nothing once every row is done.
create index if not exists uploaded_files_axes_backfill_idx
  on uploaded_files (uploaded_at)
  where browse_axes_at is null;

-- Browse's hot path: one client's documents, newest first, deleted ones gone.
-- Partial on deleted_at because the recycle bin is a rounding error next to the
-- live set and must not bloat the index every page load uses.
create index if not exists uploaded_files_browse_idx
  on uploaded_files (engagement_id, uploaded_at desc)
  where deleted_at is null;

create index if not exists uploaded_files_axes_idx
  on uploaded_files (browse_year, browse_category)
  where deleted_at is null;

-- The Recently-deleted view and the purge cron both scan exactly this.
create index if not exists uploaded_files_deleted_idx
  on uploaded_files (deleted_at)
  where deleted_at is not null;

-- ── 2. The same on final_documents ─────────────────────────────────────────
--
-- The firm's own deliverables are documents too: they belong to a client, they
-- already file out to cloud storage alongside checklist uploads (the filing
-- engine's source='final'), and the spec's preview panel distinguishes uploader
-- "client vs team" — which only means something if team-produced documents are
-- in scope. They carry no classification and no review status, so their year
-- derives from the engagement's chain and their category is Unsorted until
-- somebody sets one.
--
-- NOTE their RLS is STRICTER than uploaded_files and stays that way: 0810 gates
-- final_documents on engagement_is_private(), which 0990 deliberately did NOT
-- relax for assigned staff. Deliverables on a private engagement remain
-- owner-only, in Files exactly as everywhere else.
alter table final_documents
  add column if not exists browse_year integer
    check (browse_year is null or (browse_year between 1990 and 2100)),
  add column if not exists browse_category text,
  add column if not exists browse_year_manual boolean not null default false,
  add column if not exists browse_category_manual boolean not null default false,
  add column if not exists manual_doc_type text,
  add column if not exists browse_axes_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references users(id) on delete set null;

create index if not exists final_documents_axes_backfill_idx
  on final_documents (created_at)
  where browse_axes_at is null;

create index if not exists final_documents_browse_idx
  on final_documents (engagement_id, created_at desc)
  where deleted_at is null;

create index if not exists final_documents_deleted_idx
  on final_documents (deleted_at)
  where deleted_at is not null;

-- ── 3. Import runs ─────────────────────────────────────────────────────────
--
-- One row per import the firm starts. Shaped like filing_runs (a report header
-- with denormalized outcome counts) rather than like client_import_sessions,
-- because an import's progress must survive a page reload and be readable by
-- anyone in the firm — not just the browser tab that started it.
--
-- v1 source is 'local' (drag-and-drop) per the founder's decision; the cloud
-- providers are listed now so adding SharePoint/OneDrive next is code-only.
-- Google Drive and Dropbox are deliberately absent from the check: Vylan holds
-- drive.file / App-folder scopes on those, which can only see files VYLAN
-- created — they cannot read a firm's existing content at all, so an import
-- from them is not merely unbuilt, it is impossible without a restricted-scope
-- grant (Google verification + CASA). Adding them here later is the LAST step
-- of that work, not the first.
create table if not exists document_import_runs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  source text not null check (source in ('local', 'microsoft')),
  status text not null default 'running'
    check (status in ('running', 'complete', 'failed')),
  -- Counts settle when the run finalizes; the per-document rows are the truth.
  total_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  -- Why files were skipped, per file, for the completion summary + the retry
  -- flow: [{ name, reason }]. Bounded by the app, not the schema.
  failures jsonb not null default '[]'::jsonb,
  started_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists document_import_runs_firm_idx
  on document_import_runs (firm_id, created_at desc);

alter table document_import_runs enable row level security;

-- Read-only for members; the import worker writes with the service role.
drop policy if exists document_import_runs_select on document_import_runs;
create policy document_import_runs_select on document_import_runs for select
  using (firm_id = public.current_firm_id());

revoke all on document_import_runs from anon, authenticated;
grant select on document_import_runs to authenticated;

-- ── 4. Imported documents ──────────────────────────────────────────────────
--
-- Scoped to a CLIENT, never to an engagement — that is the point (see the
-- header). No request_item_id, no review_status: an imported file is not part
-- of anyone's checklist and there is nothing to approve.
--
-- By the founder's decision these arrive UNCLASSIFIED (no AI pass, so a firm
-- can bring in ten thousand historical files for free) and the accountant sorts
-- them by hand in Browse. That makes Move their only route out of "Unsorted",
-- which is why browse_year / browse_category / manual_doc_type are plain
-- writable columns here with no derived counterpart.
create table if not exists imported_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  import_run_id uuid references document_import_runs(id) on delete set null,
  storage_path text not null,
  original_filename text not null,
  display_name text,
  mime_type text,
  size_bytes bigint,
  -- sha256 of the bytes, same fingerprint uploaded_files uses (0270) — so the
  -- wizard's duplicate check can compare an import against documents the client
  -- already sent in, not just against other imports.
  content_hash text,
  -- The folder path the file came from ("Tremblay Inc/2023/Slips"). Kept for
  -- provenance AND because the wizard reads a year out of it to prefill
  -- browse_year — plain string parsing, no model, no cost.
  source_path text,
  browse_year integer
    check (browse_year is null or (browse_year between 1990 and 2100)),
  browse_category text,
  manual_doc_type text,
  imported_by uuid references users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists imported_documents_browse_idx
  on imported_documents (client_id, created_at desc)
  where deleted_at is null;

create index if not exists imported_documents_firm_idx
  on imported_documents (firm_id, created_at desc)
  where deleted_at is null;

create index if not exists imported_documents_run_idx
  on imported_documents (import_run_id);

create index if not exists imported_documents_deleted_idx
  on imported_documents (deleted_at)
  where deleted_at is not null;

-- Duplicate detection at import: "has this firm already got these bytes for
-- this client?" Partial — a legacy row without a hash is not a candidate.
create index if not exists imported_documents_hash_idx
  on imported_documents (client_id, content_hash)
  where content_hash is not null;

alter table imported_documents enable row level security;

-- The clients_all shape (0810): firm isolation, then the private-client cascade
-- through the security-definer helper. The 0990 assigned-staff relaxation is
-- deliberately NOT applied — that relaxation is keyed on being assigned to an
-- ENGAGEMENT, and an imported document has none, so there is nothing to be
-- assigned to. A private client's imported documents are owner-only, exactly
-- like the client record itself.
drop policy if exists imported_documents_all on imported_documents;
create policy imported_documents_all on imported_documents for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

revoke all on imported_documents from anon, authenticated;
grant select, insert, update on imported_documents to authenticated;

-- ── 5. The firm_documents view ─────────────────────────────────────────────
--
-- One relation over the three sources so Browse filters, searches, sorts and
-- PAGES in SQL. Without it, "thousands of documents per firm" means three
-- queries and a merge in Node, which cannot be paginated correctly at all.
--
-- security_invoker = true is load-bearing and NOT optional: without it the view
-- would run as its OWNER and bypass every RLS policy underneath, handing any
-- authenticated user every firm's documents. With it, each arm is filtered by
-- its own base-table policy — so uploaded_files keeps the 0990 assigned-staff
-- behaviour and final_documents keeps its stricter owner-only-when-private rule,
-- automatically, with no policy duplicated here.
--
-- Deleted rows are INCLUDED (deleted_at is exposed, not filtered): the Recently
-- deleted screen reads the same view. Every live caller filters
-- `deleted_at is null` itself.
--
-- Raw classification fields are exposed rather than a resolved doc_type: which
-- type wins (manual over AI) and whether a confidence clears the trust
-- threshold are decided ONCE, in TypeScript, next to the filing tokens that
-- already make that call. Encoding it here would be the second copy that drifts.
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
  uf.uploaded_at                   as created_at
from public.uploaded_files uf
join public.engagements e on e.id = uf.engagement_id

union all

select
  'final'::text,
  fd.id,
  fd.firm_id,
  e.client_id,
  fd.engagement_id,
  fd.storage_path,
  fd.original_filename,
  fd.display_name,
  fd.mime_type,
  fd.size_bytes,
  null::text,
  null::text,
  null::numeric,
  fd.manual_doc_type,
  fd.browse_year,
  fd.browse_category,
  null::text,
  false,
  fd.deleted_at,
  fd.deleted_by_user_id,
  fd.created_at
from public.final_documents fd
join public.engagements e on e.id = fd.engagement_id

union all

select
  'imported'::text,
  im.id,
  im.firm_id,
  im.client_id,
  null::uuid,
  im.storage_path,
  im.original_filename,
  im.display_name,
  im.mime_type,
  im.size_bytes,
  im.content_hash,
  null::text,
  null::numeric,
  im.manual_doc_type,
  im.browse_year,
  im.browse_category,
  null::text,
  false,
  im.deleted_at,
  im.deleted_by_user_id,
  im.created_at
from public.imported_documents im;

grant select on public.firm_documents to authenticated;
