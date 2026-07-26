-- Cloud-storage FILING ENGINE — Phase 1 schema.
--
-- Vylan files a firm's APPROVED client documents into the firm's own cloud
-- storage (Google Drive / SharePoint-OneDrive / Dropbox / SmartVault) using a
-- firm-configured folder template + naming convention. This migration lays down
-- ALL the filing tables so later phases are code-only:
--
--   storage_connections   one OAuth connection per firm (v1: ONE active),
--                         tokens service-role-only like QuickBooks (0410/0480)
--   firm_filing_settings  folder template + name template + language + the
--                         auto-file-on-complete switch (invoice-settings shape)
--   filing_runs           one row per push (manual or auto) — the report header
--   filed_documents       the LEDGER: one row per document per run outcome;
--                         a partial UNIQUE on filed rows is the DB-level
--                         "never file the same document twice" guarantee
--   engagements.tax_year            structured year (falls back to title scrape)
--   engagements.file_final_documents  per-engagement opt-in: final documents
--                                     stay in Vylan unless this is true
--
-- GATED like every post-launch table (dev + previews point at the prod DB):
-- all readers treat a missing table/column as "filing not set up yet" via
-- error-code checks only (the 0650 rule), so the app behaves exactly as today
-- until this file is applied.
--
-- Additive + reversible. Down:
--   drop table filed_documents; drop table filing_runs;
--   drop table firm_filing_settings; drop table storage_connections;
--   alter table engagements drop column if exists tax_year,
--     drop column if exists file_final_documents;

-- ── 1. Storage connections ──────────────────────────────────────────────────
-- One row per connect attempt; disconnect flips status (the row is KEPT so the
-- filed_documents ledger below never dangles). v1 allows ONE ACTIVE connection
-- per firm — enforced by a partial unique index, not app code, so two racing
-- connects can never both land.
create table if not exists storage_connections (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  provider text not null
    check (provider in ('google_drive', 'microsoft', 'dropbox', 'smartvault')),
  -- 'active' = usable; 'error' = refresh token dead, needs reconnect;
  -- 'disconnected' = the firm turned it off. Only 'active' rows are used.
  status text not null default 'active'
    check (status in ('active', 'error', 'disconnected')),
  -- OAuth tokens. SECRETS — service-role-only via the grant whitelist below,
  -- encrypted at rest by the app (same AES-256-GCM approach as QuickBooks).
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  -- sha256 hex of the PLAINTEXT refresh token — the optimistic-concurrency
  -- match key for rotating refreshes (GCM ciphertext can't be matched; same
  -- trick as quickbooks 0480).
  refresh_token_fingerprint text,
  -- Display fields for the connected card (non-secret): the account we're
  -- connected as ("firm@gmail.com", "Acme Team") and the chosen filing root
  -- ("Vylan filing", "Documents › Clients").
  account_label text,
  root_label text,
  -- Provider-specific plumbing (root folder id, drive id, site id, Dropbox
  -- namespace id…). Not secret, but server-only — deliberately excluded from
  -- the SELECT grant so provider internals never reach the browser.
  provider_config jsonb not null default '{}'::jsonb,
  connected_by uuid references users(id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);

-- v1's "one destination per firm", as a DB invariant.
create unique index if not exists storage_connections_active_one
  on storage_connections (firm_id) where (status = 'active');

create index if not exists storage_connections_firm_idx
  on storage_connections (firm_id, status);

alter table storage_connections enable row level security;

-- Members read their own firm's connection (drives the Filing page). No
-- insert/update/delete policy: writes are service-role-only (OAuth callback,
-- token refresh, disconnect — all server-side).
drop policy if exists storage_connections_select on storage_connections;
create policy storage_connections_select on storage_connections for select
  using (firm_id = public.current_firm_id());

-- Token lockdown (0410 pattern): revoke the default table grant, then re-grant
-- SELECT on display columns ONLY. access_token / refresh_token /
-- refresh_token_fingerprint / provider_config are unreadable via PostgREST —
-- "permission denied for column" — and only the service role reads them.
revoke all on storage_connections from anon, authenticated;
grant select (
  id,
  firm_id,
  provider,
  status,
  account_label,
  root_label,
  connected_by,
  connected_at,
  disconnected_at,
  updated_at,
  access_token_expires_at
) on storage_connections to authenticated;

-- ── 2. Firm filing settings ─────────────────────────────────────────────────
-- One row per firm, created lazily on first save (firm_invoice_settings shape).
-- A firm with no row uses the code-side defaults; the Filing settings UI is
-- owner-gated in app code, RLS enforces firm isolation.
create table if not exists firm_filing_settings (
  firm_id uuid primary key references firms(id) on delete cascade,
  -- Folder-structure template, "/"-separated segments of tokens + literal text,
  -- e.g. 'Clients/{client_name}/{year}/{category}'. Validated in code (known
  -- tokens, {client_name} required — the wrong-client-folder guard).
  folder_template text not null default 'Clients/{client_name}/{year}/{category}'
    check (char_length(folder_template) between 1 and 300),
  -- Filename template (extension is appended automatically), e.g.
  -- '{doc_type} - {year} - {detail}' — the same shape Vylan's auto display
  -- names already use, so the default filing run matches what firms see today.
  name_template text not null default '{doc_type} - {year} - {detail}'
    check (char_length(name_template) between 1 and 200),
  -- Language for RENDERED TOKEN VALUES that are labels (category and doc-type
  -- names). Folder names must be stable per firm, never per-viewing-user, so
  -- the language is an explicit firm-level choice.
  language text not null default 'en' check (language in ('en', 'fr')),
  -- Auto-file approved documents when a collection completes (Phase 4 wires the
  -- trigger). Default ON — automatic filing is the point of the feature.
  auto_file_on_complete boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table firm_filing_settings enable row level security;

drop policy if exists firm_filing_settings_select on firm_filing_settings;
create policy firm_filing_settings_select on firm_filing_settings
  for select using (firm_id = public.current_firm_id());

drop policy if exists firm_filing_settings_insert on firm_filing_settings;
create policy firm_filing_settings_insert on firm_filing_settings
  for insert with check (firm_id = public.current_firm_id());

drop policy if exists firm_filing_settings_update on firm_filing_settings;
create policy firm_filing_settings_update on firm_filing_settings
  for update using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

-- No DELETE for anyone browser-side; anon gets nothing (0650 pattern).
revoke all on firm_filing_settings from anon, authenticated;
grant select, insert, update on firm_filing_settings to authenticated;

-- ── 3. Filing runs ──────────────────────────────────────────────────────────
-- One row per push. The report header: who/what started it, when, and the
-- outcome counts (denormalized from filed_documents when the run finalizes).
-- A run whose process died stays status 'running' with no finished_at — the
-- per-document ledger rows below are still the truth of what actually landed.
create table if not exists filing_runs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  connection_id uuid not null references storage_connections(id) on delete cascade,
  trigger_source text not null check (trigger_source in ('manual', 'auto')),
  status text not null default 'running'
    check (status in ('running', 'complete')),
  filed_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  -- Null for auto (system) runs.
  started_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists filing_runs_engagement_idx
  on filing_runs (engagement_id, created_at desc);
create index if not exists filing_runs_firm_idx
  on filing_runs (firm_id, created_at desc);

alter table filing_runs enable row level security;

-- Read-only for members; the engine writes with the service role.
drop policy if exists filing_runs_select on filing_runs;
create policy filing_runs_select on filing_runs for select
  using (firm_id = public.current_firm_id());

revoke all on filing_runs from anon, authenticated;
grant select on filing_runs to authenticated;

-- ── 4. Filed documents (the ledger) ─────────────────────────────────────────
-- One row per document per run, with the outcome. THE idempotency guarantee is
-- the partial unique index: at most one FILED row per (connection, source,
-- file). A concurrent double-run hits the index, not a duplicate upload check
-- in app code — the second insert fails and is treated as "already filed".
-- file_id has no FK (it points into uploaded_files OR final_documents depending
-- on source); scoping is re-proven through engagement_id/client_id at write
-- time by the engine.
create table if not exists filed_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  connection_id uuid not null references storage_connections(id) on delete cascade,
  run_id uuid not null references filing_runs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- Which table file_id lives in: 'checklist' = uploaded_files,
  -- 'final' = final_documents.
  source text not null check (source in ('checklist', 'final')),
  file_id uuid not null,
  -- 'uploading' is the pre-upload INTENT record: the destination is written
  -- BEFORE bytes move, so even a crash mid-upload leaves an auditable row of
  -- where this document was headed. Terminal states: filed/skipped/failed.
  status text not null
    check (status in ('uploading', 'filed', 'skipped', 'failed')),
  -- Why a skip was a skip ('already_filed' | 'not_approved' | 'rejected' |
  -- 'duplicate' | 'final_not_opted_in' | 'no_bytes') / what an upload error was.
  skip_reason text,
  error_detail text,
  -- Where it landed: the human folder path ("Clients/Tremblay Inc/2024/Slips"),
  -- the final filename (collision counter included), the provider's file id and
  -- a link into the provider when its API returns one.
  folder_path text,
  filed_name text,
  provider_file_id text,
  provider_link text,
  created_at timestamptz not null default now()
);

-- The DB-level "never file twice" invariant (per destination, per document).
create unique index if not exists filed_documents_filed_once
  on filed_documents (connection_id, source, file_id) where (status = 'filed');

create index if not exists filed_documents_run_idx
  on filed_documents (run_id);
create index if not exists filed_documents_engagement_idx
  on filed_documents (engagement_id, created_at desc);

alter table filed_documents enable row level security;

drop policy if exists filed_documents_select on filed_documents;
create policy filed_documents_select on filed_documents for select
  using (firm_id = public.current_firm_id());

revoke all on filed_documents from anon, authenticated;
grant select on filed_documents to authenticated;

-- ── 5. Engagement additions ─────────────────────────────────────────────────
-- Structured tax year: the deterministic source for the {year} filing token
-- (and, later, the AI's expected-year context). Nullable — existing engagements
-- keep the title-scrape fallback (expectedYearFromTitle).
alter table engagements
  add column if not exists tax_year integer
    check (tax_year is null or (tax_year between 2000 and 2100));

-- Final documents (the accountant's deliverables) NEVER leave Vylan unless the
-- firm opts this engagement in. Default off.
alter table engagements
  add column if not exists file_final_documents boolean not null default false;
