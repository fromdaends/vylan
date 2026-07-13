-- Final documents (feature: invoicing at engagement start + Final documents lock).
--
-- The accountant's RETURN path: completed deliverables the accountant uploads to
-- send BACK to the client (the finished return PDF, statements, letters). Distinct
-- from the client's own uploads (uploaded_files) and from signed documents
-- (signature_requests). The client sees and downloads these in the portal.
--
-- In a later phase, an unpaid invoice with locks_deliverables can gate CLIENT
-- access to these files, enforced server-side at the single
-- /api/portal/deliverables route. This migration only creates the storage; the
-- lock is enforced later and NEVER blocks uploads or signing.
--
-- firm_id is stored directly (unlike uploaded_files, which scopes via a join
-- through the engagement) so the firm-scoped RLS is a simple current_firm_id()
-- check, mirroring clients / engagements / activity_log. The client portal reads
-- these through the service-role client (bypasses RLS) after validating the magic
-- token + engagement match, so no client-facing policy is needed.
--
-- Additive + reversible (down: drop table). The app degrades to "no final
-- documents" before this is applied.

create table if not exists final_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  -- Optional cleaner display name; falls back to original_filename.
  display_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists final_documents_engagement_idx
  on final_documents (engagement_id, created_at desc);

alter table final_documents enable row level security;

create policy final_documents_all on final_documents for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());
