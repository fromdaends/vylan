-- QuickBooks per-client: correct 0710's unique indexes to be PostgREST-usable.
--
-- 0710 created the per-client unique indexes as `coalesce(client_id, <sentinel>)`
-- EXPRESSION indexes. An expression index CANNOT be an ON CONFLICT arbiter
-- (Postgres 42P10), so the per-client upserts — which target
-- onConflict "firm_id,client_id[,qbo_id]" — would fail. Replace them with PLAIN
-- column-list unique indexes using NULLS NOT DISTINCT (Postgres 15+): PostgREST
-- CAN target these, and NULLS NOT DISTINCT still keeps the firm-level
-- (client_id NULL) row unique so a legacy row can't duplicate.
--
-- This is shipped as a SEPARATE migration (not an edit to 0710) so it corrects the
-- indexes in ANY environment regardless of whether 0710 was already applied —
-- migrations run in order, so 0710 always precedes this. Also drops 0710's
-- now-redundant `*_client_idx` helper indexes (the leftmost prefix of each new
-- unique index already covers (firm_id, client_id) lookups). Idempotent.

-- connections
drop index if exists quickbooks_connections_firm_client_idx;
drop index if exists quickbooks_connections_client_idx;
create unique index if not exists quickbooks_connections_firm_client_idx
  on quickbooks_connections (firm_id, client_id) nulls not distinct;

-- cache tables + items
drop index if exists quickbooks_accounts_scope_qbo_idx;
drop index if exists quickbooks_accounts_client_idx;
create unique index if not exists quickbooks_accounts_scope_qbo_idx
  on quickbooks_accounts (firm_id, client_id, qbo_id) nulls not distinct;

drop index if exists quickbooks_vendors_scope_qbo_idx;
drop index if exists quickbooks_vendors_client_idx;
create unique index if not exists quickbooks_vendors_scope_qbo_idx
  on quickbooks_vendors (firm_id, client_id, qbo_id) nulls not distinct;

drop index if exists quickbooks_customers_scope_qbo_idx;
drop index if exists quickbooks_customers_client_idx;
create unique index if not exists quickbooks_customers_scope_qbo_idx
  on quickbooks_customers (firm_id, client_id, qbo_id) nulls not distinct;

drop index if exists quickbooks_tax_codes_scope_qbo_idx;
drop index if exists quickbooks_tax_codes_client_idx;
create unique index if not exists quickbooks_tax_codes_scope_qbo_idx
  on quickbooks_tax_codes (firm_id, client_id, qbo_id) nulls not distinct;

drop index if exists quickbooks_items_scope_qbo_idx;
drop index if exists quickbooks_items_client_idx;
create unique index if not exists quickbooks_items_scope_qbo_idx
  on quickbooks_items (firm_id, client_id, qbo_id) nulls not distinct;

-- learned mappings
drop index if exists quickbooks_learned_scope_idx;
drop index if exists quickbooks_learned_client_idx;
create unique index if not exists quickbooks_learned_scope_idx
  on quickbooks_learned_mappings (firm_id, client_id, signal_type, source_key)
  nulls not distinct;
