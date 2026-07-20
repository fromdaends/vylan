-- Bookkeeping client import — staging table.
--
-- "Import your client list from QuickBooks / Xero": the accountant signs into
-- their OWN company (the books where their clients exist as customers), the
-- OAuth callback reads the customer/contact list, stages it HERE, and releases
-- the provider connection immediately (nothing persists provider-side — for
-- Xero this frees the 5-connection free-tier slot). The import page then shows
-- the staged candidates for review; confirming creates Vylan clients through
-- the same validated bulk path the CSV import uses.
--
-- Rows are one-shot and short-lived: consumed_at is stamped when the import
-- commits, and readers ignore sessions older than 1 hour. No tokens or secrets
-- are ever stored here — only display candidates (name/email/phone).
--
-- Additive + reversible (down: drop table client_import_sessions).

create table if not exists client_import_sessions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'xero')),
  -- The connected company's display name ("imported from …" context).
  source_name text,
  -- The staged candidates: [{display_name, email, phone}] (jsonb). Validated
  -- again server-side at commit — never trusted as-is.
  candidates jsonb not null default '[]'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists client_import_sessions_firm_idx
  on client_import_sessions (firm_id, created_at desc);

alter table client_import_sessions enable row level security;

-- Firm members may READ their own firm's sessions (the import review page).
-- Writes are service-role-only (the OAuth callback + consume stamp).
drop policy if exists client_import_sessions_select on client_import_sessions;
create policy client_import_sessions_select on client_import_sessions for select
  using (firm_id = public.current_firm_id());

revoke all on client_import_sessions from anon, authenticated;
grant select (
  id,
  firm_id,
  provider,
  source_name,
  candidates,
  created_by,
  created_at,
  consumed_at
) on client_import_sessions to authenticated;
