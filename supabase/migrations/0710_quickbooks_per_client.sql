-- QuickBooks: per-client connections — Phase 1 (data model).
--
-- Moves QuickBooks from ONE connection per FIRM to ONE connection per CLIENT, so
-- an accounting firm can post each client's receipts into that client's OWN
-- QuickBooks company (the way firms actually keep books). Before this, a firm
-- could connect a single company (0410's `firm_id unique`), so posting only ever
-- worked for one client.
--
-- This migration is purely ADDITIVE and TRANSITION-SAFE:
--   * Every table gains a NULLABLE `client_id`. A NULL means "firm-level" — the
--     existing (single) connection + its cached rows keep working untouched, so
--     nothing breaks before the connect flow (Phase 2) starts writing client_id.
--   * The old firm-level UNIQUE constraints are replaced by per-client unique
--     indexes that include client_id and use `NULLS NOT DISTINCT` (Postgres 15+):
--     NULLs compare EQUAL, so the one legacy firm-level (NULL) row still can't
--     duplicate, while each real client gets its own uniqueness namespace. These
--     are PLAIN column-list unique indexes (NOT expression indexes) precisely so
--     PostgREST's upsert `onConflict` can target them (an expression index cannot
--     be an ON CONFLICT arbiter — it would 42P10).
--   * RLS stays firm-scoped: firm isolation already prevents cross-firm reads, and
--     within a firm every member may see all of that firm's clients' cached lists
--     (same visibility as today) — so no policy change is needed.
--
-- Down (manual): drop the *_scope_qbo_idx / *_firm_client_idx unique indexes,
-- restore the original firm-level UNIQUE constraints, and drop the client_id cols.

-- ── 1. quickbooks_connections: one per (firm, client) ────────────────────────
alter table quickbooks_connections
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- The connection's non-secret display columns are SELECTable via a column grant
-- whitelist (0410). client_id is non-secret (it says WHICH client this is) and
-- the UI needs it, so add it to the grant.
grant select (client_id) on quickbooks_connections to authenticated;

-- Replace the one-per-firm unique (0410's inline `firm_id ... unique`) with one
-- per (firm, client). NULLS NOT DISTINCT keeps at most one legacy firm-level
-- (NULL) row per firm; PostgREST upserts target this via onConflict "firm_id,
-- client_id".
alter table quickbooks_connections
  drop constraint if exists quickbooks_connections_firm_id_key;
create unique index if not exists quickbooks_connections_firm_client_idx
  on quickbooks_connections (firm_id, client_id) nulls not distinct;

-- ── 2. Cache tables: one row per (firm, client, qbo_id) ───────────────────────
-- Each client's QuickBooks has its OWN accounts / vendors / customers / tax codes
-- / items, so the cache must be scoped per client, not per firm. Plain-column
-- unique indexes with NULLS NOT DISTINCT so upserts can target
-- onConflict "firm_id,client_id,qbo_id" (and legacy NULL-client rows stay unique).

alter table quickbooks_accounts
  add column if not exists client_id uuid references clients(id) on delete cascade;
alter table quickbooks_accounts
  drop constraint if exists quickbooks_accounts_firm_id_qbo_id_key;
create unique index if not exists quickbooks_accounts_scope_qbo_idx
  on quickbooks_accounts (firm_id, client_id, qbo_id) nulls not distinct;

alter table quickbooks_vendors
  add column if not exists client_id uuid references clients(id) on delete cascade;
alter table quickbooks_vendors
  drop constraint if exists quickbooks_vendors_firm_id_qbo_id_key;
create unique index if not exists quickbooks_vendors_scope_qbo_idx
  on quickbooks_vendors (firm_id, client_id, qbo_id) nulls not distinct;

alter table quickbooks_customers
  add column if not exists client_id uuid references clients(id) on delete cascade;
alter table quickbooks_customers
  drop constraint if exists quickbooks_customers_firm_id_qbo_id_key;
create unique index if not exists quickbooks_customers_scope_qbo_idx
  on quickbooks_customers (firm_id, client_id, qbo_id) nulls not distinct;

alter table quickbooks_tax_codes
  add column if not exists client_id uuid references clients(id) on delete cascade;
alter table quickbooks_tax_codes
  drop constraint if exists quickbooks_tax_codes_firm_id_qbo_id_key;
create unique index if not exists quickbooks_tax_codes_scope_qbo_idx
  on quickbooks_tax_codes (firm_id, client_id, qbo_id) nulls not distinct;

alter table quickbooks_items
  add column if not exists client_id uuid references clients(id) on delete cascade;
alter table quickbooks_items
  drop constraint if exists quickbooks_items_firm_id_qbo_id_key;
create unique index if not exists quickbooks_items_scope_qbo_idx
  on quickbooks_items (firm_id, client_id, qbo_id) nulls not distinct;

-- ── 3. Learned mappings: one per (firm, client, signal, source) ───────────────
-- "Learn from corrections" memory is per client — a client's own vendor/account
-- picks shouldn't bleed across clients (and are strictly better kept separate).
alter table quickbooks_learned_mappings
  add column if not exists client_id uuid references clients(id) on delete cascade;
alter table quickbooks_learned_mappings
  drop constraint if exists quickbooks_learned_mappings_firm_id_signal_type_source_key_key;
create unique index if not exists quickbooks_learned_scope_idx
  on quickbooks_learned_mappings (firm_id, client_id, signal_type, source_key)
  nulls not distinct;
