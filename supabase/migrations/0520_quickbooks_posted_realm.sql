-- QuickBooks smart match-or-create — scope the "Vylan already posted this"
-- exclusion set to the CURRENTLY connected company (realm).
--
-- The register-match step excludes every transaction Vylan itself posted so a
-- transaction we created never reads back as "already in QuickBooks". Those ids
-- were previously collected firm-wide with no realm scoping. QuickBooks ids are
-- per-company sequential integers, so after a firm SWITCHES QuickBooks companies
-- (e.g. the sandbox → production flip at go-live, or reconnecting a different
-- company) an id minted under the OLD company readily collides with a real id in
-- the NEW company — wrongly excluding a genuine candidate and letting a
-- duplicate be created. posted_realm_id records which company each draft was
-- posted/matched under so the exclusion can be filtered to the live realm.
--
-- Backfill EXISTING posted rows to the firm's currently-connected realm: today
-- every firm has a single quickbooks_connections row, so its posted drafts all
-- belong to that realm. (A firm that already switched companies BEFORE this
-- migration is the rare exception; the approximation is no worse than the prior
-- firm-wide scope, and self-corrects as new posts stamp the live realm.)
--
-- Strictly additive + nullable; the app degrades gracefully (isMissingSchema)
-- until this is applied — listFirmPostedQboIds falls back to the prior firm-wide
-- read, so matching keeps working. The table-level SELECT grant (0430) covers
-- this new column for firm members; writes stay service-role-only.
-- Additive + reversible.

alter table quickbooks_transaction_suggestions
  add column if not exists posted_realm_id text;

update quickbooks_transaction_suggestions s
  set posted_realm_id = c.realm_id
  from quickbooks_connections c
  where s.firm_id = c.firm_id
    and s.posted_qbo_id is not null
    and s.posted_realm_id is null;
