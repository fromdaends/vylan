-- QuickBooks reference-data cache — Stage 2, Phase 4.
--
-- Caches the connected company's Accounts / Vendors / Customers / Tax Codes so
-- the Settings page loads instantly from Vylan's own copy instead of calling
-- QuickBooks on every render, and so the future document-mapping stage has the
-- lists ready locally. Synced by a background job (jobs.kind = 'sync_quickbooks',
-- drained by the every-2-min process-jobs cron).
--
-- This is NON-SECRET firm data (just names + types), so unlike the OAuth token
-- columns in 0410, firm members may SELECT their OWN firm's cached rows directly
-- via RLS. All WRITES are service-role-only (the sync job): authenticated users
-- cannot tamper with the cache.
--
-- Additive + reversible (down: drop the four tables + the three sync columns).

-- Sync bookkeeping lives on the connection row (one per firm). These are
-- non-secret display fields, so we extend the authenticated SELECT grant from
-- 0410 to include them (the access_token / refresh_token columns stay hidden).
alter table quickbooks_connections
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_status text not null default 'idle'
    check (sync_status in ('idle', 'syncing', 'ok', 'error')),
  add column if not exists sync_error text;
grant select (last_synced_at, sync_status, sync_error)
  on quickbooks_connections to authenticated;

-- ── Cache tables. One row per (firm, qbo_id). name + active for all; accounts
-- also carry account_type. (The full raw QBO object can be added here later when
-- the transaction-posting stage needs more fields.)

create table if not exists quickbooks_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  qbo_id text not null,
  name text not null default '',
  account_type text,
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, qbo_id)
);
create index if not exists quickbooks_accounts_firm_idx on quickbooks_accounts (firm_id);

create table if not exists quickbooks_vendors (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  qbo_id text not null,
  name text not null default '',
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, qbo_id)
);
create index if not exists quickbooks_vendors_firm_idx on quickbooks_vendors (firm_id);

create table if not exists quickbooks_customers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  qbo_id text not null,
  name text not null default '',
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, qbo_id)
);
create index if not exists quickbooks_customers_firm_idx on quickbooks_customers (firm_id);

create table if not exists quickbooks_tax_codes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  qbo_id text not null,
  name text not null default '',
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, qbo_id)
);
create index if not exists quickbooks_tax_codes_firm_idx on quickbooks_tax_codes (firm_id);

-- RLS: firm members may READ their own firm's cached lists (non-secret). No
-- write policy => authenticated insert/update/delete are denied; the sync job
-- writes via the service role (which bypasses RLS). We also revoke the default
-- PostgREST grants and re-grant SELECT to authenticated ONLY (removing anon's
-- access entirely) — the repo's table-grant hardening pattern (0190 / 0230). The
-- firm-scoped SELECT policy then gates which rows authenticated can read.
alter table quickbooks_accounts enable row level security;
drop policy if exists quickbooks_accounts_select on quickbooks_accounts;
create policy quickbooks_accounts_select on quickbooks_accounts for select
  using (firm_id = public.current_firm_id());
revoke all on quickbooks_accounts from anon, authenticated;
grant select on quickbooks_accounts to authenticated;

alter table quickbooks_vendors enable row level security;
drop policy if exists quickbooks_vendors_select on quickbooks_vendors;
create policy quickbooks_vendors_select on quickbooks_vendors for select
  using (firm_id = public.current_firm_id());
revoke all on quickbooks_vendors from anon, authenticated;
grant select on quickbooks_vendors to authenticated;

alter table quickbooks_customers enable row level security;
drop policy if exists quickbooks_customers_select on quickbooks_customers;
create policy quickbooks_customers_select on quickbooks_customers for select
  using (firm_id = public.current_firm_id());
revoke all on quickbooks_customers from anon, authenticated;
grant select on quickbooks_customers to authenticated;

alter table quickbooks_tax_codes enable row level security;
drop policy if exists quickbooks_tax_codes_select on quickbooks_tax_codes;
create policy quickbooks_tax_codes_select on quickbooks_tax_codes for select
  using (firm_id = public.current_firm_id());
revoke all on quickbooks_tax_codes from anon, authenticated;
grant select on quickbooks_tax_codes to authenticated;
