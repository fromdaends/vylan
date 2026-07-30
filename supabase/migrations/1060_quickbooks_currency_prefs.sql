-- Record the connected QuickBooks company's CURRENCY SETTINGS.
--
-- Xero had this hazard and 1030 fixed it: a CAD invoice posted into a USD
-- organisation was recorded as USD at face value — the right number against the
-- wrong currency, which no later reconciliation catches because the figure looks
-- correct. QuickBooks has the identical hazard and no fix: the QBO builders never
-- send CurrencyRef, so a foreign-currency document is booked in the company's own
-- currency.
--
-- NOT a copy of 1030, and this is the whole reason it needs its own migration.
-- Xero always accepts a CurrencyCode. QuickBooks REFUSES one unless multicurrency
-- is switched on for that company, so knowing the home currency is not enough —
-- we also have to know whether the company can express a foreign currency at all.
-- Both come from QuickBooks' Preferences entity (CurrencyPrefs.HomeCurrency and
-- CurrencyPrefs.MultiCurrencyEnabled), not CompanyInfo.
--
-- BOTH NULLABLE WITH NO DEFAULT. Null means "we have not read this company's
-- preferences", which must behave as "we cannot state a currency" rather than as
-- a guess — the same rule the shared draft gate already applies via
-- TransactionSuggestion.booksCurrency. A connection made before this migration
-- keeps today's behaviour exactly until it is re-read.
--
-- multicurrency_enabled is deliberately three-state (true / false / unknown):
-- false is a positive "this company cannot take a CurrencyRef", which is
-- different information from "we never looked".
--
-- Written by a separate best-effort UPDATE after the connection is saved, never
-- as part of the connection upsert — that upsert has a tiered
-- fallback that returns "migration_pending" when a column is missing and an
-- encryption key is configured, so folding these in would have made connecting to
-- QuickBooks fail outright until this SQL was run.
--
-- No new grant needed: 0410 revokes and re-grants column-level SELECT for the
-- non-secret display fields; these two are not in that whitelist and are read
-- only by the service role, which bypasses it.
--
-- Additive + reversible (down: drop the two columns).

alter table quickbooks_connections
  add column if not exists home_currency text,
  add column if not exists multicurrency_enabled boolean;

-- Verify after applying:
--   select company_name, home_currency, multicurrency_enabled
--   from quickbooks_connections;
--
-- Expect NULLs until each connection is re-read (reconnect, or the sync job).
