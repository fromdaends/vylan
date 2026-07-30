-- The currency each cached QuickBooks supplier and customer is DENOMINATED in.
--
-- In QuickBooks a party carries a currency, and a transaction cannot depart from
-- it. Verified against a live sandbox rather than assumed:
--
--   USD bill on a CAD supplier  -> 400 "You can only use one foreign currency
--                                       per transaction."
--   USD bill on an HKD supplier -> 400, same
--   HKD bill on the HKD supplier-> accepted
--
-- The matcher picks a party by NAME and has never known any of this, so a USD
-- receipt would match the correctly-named CAD supplier and then fail at post time
-- with a message that explains nothing to an accountant. Caching the currency is
-- what lets the matcher refuse up front and say something useful instead.
--
-- Xero needs none of this: a Xero contact is currency-neutral and the transaction
-- states its own currency. This is a QuickBooks-shaped problem.
--
-- NULLABLE WITH NO DEFAULT. Null means "not synced since this column existed",
-- and every reader treats unknown as "no opinion" — nothing is filtered out, so a
-- client not yet resynced matches exactly as it does today. Writing a value is a
-- positive statement that QuickBooks reported one.
--
-- Also worth recording, because it constrains the feature built on top: a party's
-- currency is chosen when it is CREATED and cannot be changed afterwards, and
-- QuickBooks SILENTLY IGNORES CurrencyRef on both create and update over the API
-- (returns 200 with the home currency). So Vylan can never create a
-- foreign-currency supplier — the accountant must do it in QuickBooks itself.
--
-- No new grant needed: 0420 grants SELECT on the whole table to authenticated.
--
-- Additive + reversible (down: drop the two columns).

alter table quickbooks_vendors
  add column if not exists currency text;

alter table quickbooks_customers
  add column if not exists currency text;

-- Verify after applying:
--   select name, currency from quickbooks_vendors order by currency nulls last;
--
-- Expect NULLs until the next QuickBooks sync repopulates the cache.
