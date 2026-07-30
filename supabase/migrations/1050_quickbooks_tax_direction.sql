-- Which DIRECTION a cached QuickBooks tax code may be used in.
--
-- The matcher picked a tax code by name similarity with no idea whether the
-- document was a sale or a purchase. On a client carrying both "GST/RST on
-- Purchases" and "GST on Income" that was a coin flip — and a purchases rate on
-- a sale reports the tax to the wrong side of the return.
--
-- Xero solved this in 0980 with can_apply_to_revenue / can_apply_to_expenses,
-- and the matcher change was written provider-neutral: matchTaxCode already
-- takes a direction and filters candidates before scoring, and the two flags on
-- QbTaxCode are already OPTIONAL. So QuickBooks only ever needed the flags
-- populated — no matcher work.
--
-- THE SIGNAL IS DIFFERENT FROM XERO'S, which is why this is not a copy of 0980.
-- Xero publishes CanApplyToRevenue / CanApplyToExpenses per rate. QuickBooks
-- publishes SalesTaxRateList and PurchaseTaxRateList on each TaxCode: the code is
-- usable on sales when its sales list has rates in it, and on purchases when its
-- purchase list does. Different shape, same question — the adapter derives these
-- two booleans from those lists.
--
-- NULLABLE WITH NO DEFAULT, deliberately. Null means "we have not synced this
-- client since the column existed", and every reader treats absent as "no
-- opinion, keep the code" (`!== false`). An un-resynced client therefore keeps
-- seeing every tax code exactly as today, rather than getting an empty picker.
-- Writing `false` is a positive statement that QuickBooks reported an empty list.
--
-- No new grant needed: 0420 grants SELECT on the whole table to authenticated
-- (unlike xero_connections, which is column-whitelisted), so new columns are
-- covered. RLS still gates the rows.
--
-- Additive + reversible (down: drop the two columns).

alter table quickbooks_tax_codes
  add column if not exists can_apply_to_revenue boolean,
  add column if not exists can_apply_to_expenses boolean;

-- Verify after applying:
--   select name, can_apply_to_revenue, can_apply_to_expenses
--   from quickbooks_tax_codes order by name;
--
-- Expect NULLs until the next QuickBooks sync repopulates the cache.
