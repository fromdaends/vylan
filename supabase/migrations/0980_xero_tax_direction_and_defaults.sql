-- Xero — stop guessing sales tax, and stop asking for the same bank account.
--
-- 1. TAX DIRECTION. Our matcher is handed the document's taxes and the whole
--    list of Xero tax rates, and picks by name similarity alone. Nothing tells
--    it whether the document is a SALE or a PURCHASE, so on a client that has
--    both variants ("GST/RST on Purchases" and "GST on Income") it is a coin
--    flip -- and a purchases rate on a sale puts the tax in the wrong box on the
--    client's return. Xero already publishes the answer on every rate:
--    CanApplyToRevenue / CanApplyToExpenses. We simply were not storing it.
--
--    Both default TRUE so every row cached before this migration keeps matching
--    exactly as it does today; the next sync overwrites them with Xero's real
--    values. Defaulting to false would silently empty the candidate list for
--    every client until they re-synced.
--
-- 2. REMEMBERED BANK ACCOUNTS. A paid expense needs the account it was paid
--    FROM, and a paid sale needs the account it was deposited TO. Today the
--    accountant re-picks that on every single document even though it is almost
--    always the same account. Remembered per client, like default_publish_status
--    (0970), so it is asked once and filled in from then on.
--
-- Additive + reversible (down: drop the three columns).

alter table xero_tax_rates
  add column if not exists can_apply_to_revenue boolean not null default true,
  add column if not exists can_apply_to_expenses boolean not null default true;

alter table xero_connections
  add column if not exists default_payment_account_id text,
  add column if not exists default_deposit_account_id text;

-- Non-secret display columns -> extend 0740's column-grant whitelist. The token
-- columns stay unreadable by authenticated users.
grant select (default_payment_account_id, default_deposit_account_id)
  on xero_connections to authenticated;

-- Verify after applying:
--   select column_name from information_schema.columns
--    where table_name = 'xero_tax_rates'
--      and column_name in ('can_apply_to_revenue','can_apply_to_expenses');
--   select column_name from information_schema.columns
--    where table_name = 'xero_connections'
--      and column_name in ('default_payment_account_id','default_deposit_account_id');
