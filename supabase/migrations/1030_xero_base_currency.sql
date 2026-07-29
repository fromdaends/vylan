-- Record each connected Xero organisation's BASE CURRENCY.
--
-- Found by posting a real CAD invoice into a USD demo organisation and reading
-- it back: $6,720 CAD was recorded as $6,720 USD. We never sent a CurrencyCode,
-- so Xero booked the amounts in the organisation's own currency, and nothing
-- anywhere compared the two.
--
-- Harmless while every client is a Canadian organisation handling Canadian
-- documents — which is why it went unnoticed — and a silent misstatement the
-- moment one is not. A US-incorporated subsidiary, a client billing in USD, or
-- the founder's own USD demo organisation all hit it.
--
-- Nullable with no default: a connection made before this migration has no
-- recorded currency, and "unknown" must behave as "don't claim to know" rather
-- than defaulting to something plausible and being confidently wrong. It is
-- populated on the next connect or reconnect.
--
-- Non-secret display field -> joins 0740's column-grant whitelist.
--
-- Additive + reversible (down: drop the column).

alter table xero_connections
  add column if not exists base_currency text;

grant select (base_currency) on xero_connections to authenticated;

-- Verify after applying:
--   select tenant_name, base_currency from xero_connections;
