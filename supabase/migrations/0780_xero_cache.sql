-- Xero reference-data cache — Phase 2 (per client).
--
-- Caches each connected Xero organisation's Accounts / Contacts / Tax Rates /
-- Items so the draft-matching stage has the lists locally (mirrors the
-- QuickBooks cache, 0420 + per-client 0710) — but per-client from day one, so
-- every table carries a NOT NULL client_id and uniqueness is (firm_id,
-- client_id, xero_id). Synced by a background job (jobs.kind = 'sync_xero',
-- drained by the every-2-min process-jobs cron).
--
-- Xero specifics baked into the shape:
--   * Xero has ONE unified Contact list — no separate vendors/customers — so
--     xero_contacts carries is_supplier / is_customer flags and the read layer
--     splits it (a contact that is BOTH, or NEITHER yet, lands in both lists).
--   * Accounts store a NORMALIZED account_type ('Expense' / 'Income' / 'Bank' /
--     'Credit Card' / raw) computed at sync time so the shared matcher's
--     type predicates work unchanged; the raw code is kept for later posting.
--   * Tax rates key on TaxType (the code put on lines); items key on ItemID.
--
-- NON-SECRET firm data (names/types), so firm members may SELECT their OWN
-- firm's rows via RLS; all WRITES are service-role (the sync job).
--
-- Additive + reversible (down: drop the four tables + the three sync columns).

-- Sync bookkeeping on the connection row (mirrors 0420's columns on
-- quickbooks_connections). Non-secret display fields → extend the authenticated
-- SELECT grant from 0740 (the token columns stay hidden).
alter table xero_connections
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_status text not null default 'idle'
    check (sync_status in ('idle', 'syncing', 'ok', 'error')),
  add column if not exists sync_error text;
grant select (last_synced_at, sync_status, sync_error)
  on xero_connections to authenticated;

-- ── Cache tables. One row per (firm, client, xero_id). ───────────────────────

create table if not exists xero_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  xero_id text not null,            -- Xero AccountID (uuid)
  code text,                        -- Xero AccountCode (may be absent on banks)
  name text not null default '',
  account_type text,                -- NORMALIZED for the matcher (Expense/Income/Bank/Credit Card/raw)
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, client_id, xero_id)
);
create index if not exists xero_accounts_scope_idx
  on xero_accounts (firm_id, client_id);

create table if not exists xero_contacts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  xero_id text not null,            -- Xero ContactID (uuid)
  name text not null default '',
  is_supplier boolean not null default false,
  is_customer boolean not null default false,
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, client_id, xero_id)
);
create index if not exists xero_contacts_scope_idx
  on xero_contacts (firm_id, client_id);

create table if not exists xero_tax_rates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  xero_id text not null,            -- Xero TaxType (the code put on lines, e.g. CAN007)
  name text not null default '',
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, client_id, xero_id)
);
create index if not exists xero_tax_rates_scope_idx
  on xero_tax_rates (firm_id, client_id);

create table if not exists xero_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  xero_id text not null,            -- Xero ItemID (uuid)
  code text,                        -- Xero item Code (referenced on lines)
  name text not null default '',
  income_account_code text,         -- SalesDetails.AccountCode (income → item bridge)
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, client_id, xero_id)
);
create index if not exists xero_items_scope_idx
  on xero_items (firm_id, client_id);

-- RLS: firm members READ their own firm's rows; writes are service-role only
-- (no write policy → authenticated insert/update/delete denied). Revoke the
-- default PostgREST grants + re-grant SELECT to authenticated only (0190/0230
-- hardening pattern); the firm-scoped SELECT policy gates which rows show.
alter table xero_accounts enable row level security;
drop policy if exists xero_accounts_select on xero_accounts;
create policy xero_accounts_select on xero_accounts for select
  using (firm_id = public.current_firm_id());
revoke all on xero_accounts from anon, authenticated;
grant select on xero_accounts to authenticated;

alter table xero_contacts enable row level security;
drop policy if exists xero_contacts_select on xero_contacts;
create policy xero_contacts_select on xero_contacts for select
  using (firm_id = public.current_firm_id());
revoke all on xero_contacts from anon, authenticated;
grant select on xero_contacts to authenticated;

alter table xero_tax_rates enable row level security;
drop policy if exists xero_tax_rates_select on xero_tax_rates;
create policy xero_tax_rates_select on xero_tax_rates for select
  using (firm_id = public.current_firm_id());
revoke all on xero_tax_rates from anon, authenticated;
grant select on xero_tax_rates to authenticated;

alter table xero_items enable row level security;
drop policy if exists xero_items_select on xero_items;
create policy xero_items_select on xero_items for select
  using (firm_id = public.current_firm_id());
revoke all on xero_items from anon, authenticated;
grant select on xero_items to authenticated;
