-- Xero — let ONE Xero Demo Company back several clients (testing only).
--
-- 0740 created a PLAIN unique index on xero_connections.tenant_id, so a Xero
-- organisation could back exactly one client row, ever. That rule is right for
-- REAL organisations: in Xero one organisation IS one legal entity (its own
-- subscription, chart of accounts, bank feeds and tax filings), so two clients
-- sharing one org would mean approving a receipt for client A and posting it
-- into client B's books. The rule stays for them.
--
-- But Xero issues exactly ONE Demo Company per login, so the rule also made it
-- impossible to test more than a single client connection at a time. The Demo
-- Company is a disposable sandbox (it self-resets every 28 days), so nothing it
-- holds is real books.
--
-- Hence a PARTIAL unique index: uniqueness is enforced only where
-- is_demo = false. is_demo is written at connect time from Xero's own
-- Organisation.IsDemoCompany flag (never from user input), so a real
-- organisation cannot opt itself into sharing.
--
-- DROP FIRST — DO NOT "create unique index if not exists" ALONE. Postgres
-- matches `if not exists` on the index NAME, not its definition, so recreating
-- xero_connections_tenant_idx without dropping it would either abort with
-- 42P07 (already exists) or, with `if not exists`, silently no-op and leave the
-- OLD non-partial index in place — the change would appear to ship while
-- changing nothing. Same drop-then-create shape as 0720.
--
-- Additive + reversible (down: drop both indexes, recreate the plain unique
-- index from 0740 — only possible while no demo org backs two clients).

drop index if exists xero_connections_tenant_idx;
create unique index if not exists xero_connections_tenant_idx
  on xero_connections (tenant_id)
  where is_demo = false;

-- The partial unique index above can only serve queries the planner can prove
-- satisfy its predicate, and findXeroTenantIdsInUse() looks up tenant_id with
-- NO is_demo filter (it must see demo rows — that is the whole point of the
-- link-release guards). Without this plain index that lookup would fall back to
-- a sequential scan on every connect, disconnect and import release.
create index if not exists xero_connections_tenant_lookup_idx
  on xero_connections (tenant_id);

-- Verify after applying:
--   select indexdef from pg_indexes where indexname = 'xero_connections_tenant_idx';
-- must contain: WHERE (is_demo = false)
