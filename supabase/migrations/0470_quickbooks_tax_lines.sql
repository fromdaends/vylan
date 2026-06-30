-- QuickBooks tax-line refinement — Stage 5.
--
-- Posted Bills/Invoices currently record the GROSS total on a single line with NO
-- tax code, so GST/QST is not tracked in QuickBooks. This migration adds the two
-- columns the tax-aware posting path needs. Strictly additive + reversible; the
-- app degrades gracefully (isMissingSchema) until it is applied, so posting keeps
-- working exactly as before (gross, no tax) in the meantime.
--
-- 1) quickbooks_connections.company_country
--    The connected company's country (e.g. "US", "CA"), read once from
--    CompanyInfo at connect time (and self-healed on sync). It drives ONE choice:
--    "GlobalTaxCalculation" is a NON-US field, so we send it only for non-US
--    (Canadian) companies and omit it for US companies (whose Automated Sales Tax
--    engine computes tax from the line's tax code instead). Non-secret company
--    metadata, like company_name — granted SELECT to authenticated members. The
--    quickbooks_connections table uses the column-level grant whitelist (0410,
--    secret token columns), so a NEW column is unreadable until explicitly granted.
--
-- 2) quickbooks_transaction_suggestions.posted_tax_note
--    A short, human-readable note set when a posted transaction's QuickBooks-
--    computed tax differs from the tax printed on the document (a rate mismatch or
--    rounding drift). Surfaced on the card so a discrepancy is never silent. Null
--    when the amounts agree (the normal case). The suggestions table uses a
--    table-level SELECT grant (0430), so this column is covered automatically.

alter table quickbooks_connections
  add column if not exists company_country text;
grant select (company_country) on quickbooks_connections to authenticated;

alter table quickbooks_transaction_suggestions
  add column if not exists posted_tax_note text;
