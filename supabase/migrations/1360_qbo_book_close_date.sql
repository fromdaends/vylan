-- The connected QuickBooks company's closing date, cached alongside the currency
-- preferences it is read with.
--
-- Intuit returns every preference group in one /preferences response, so this
-- costs no extra API call — it rides along on the request fetchCurrencyPrefs was
-- already making.
--
-- ADVISORY ONLY. This is refreshed on connect and on sync, so it goes stale the
-- moment a client changes their closing date in QuickBooks. It must never gate a
-- post: a stale "closed" would block a post that would actually succeed. The
-- authoritative answer is Intuit rejecting the write with fault 6200/6210, which
-- is always current — see INTUIT_PERIOD_CLOSED_CODES.
--
-- Deploy-ahead safe: the code writes this column through a patch that tolerates
-- a missing column (isMissingSchema), and reads it as null when absent. Nothing
-- breaks while this migration is unapplied — posting behaves exactly as it does
-- today, discovering a closed period from the rejection instead of in advance.

alter table if exists public.quickbooks_connections
  add column if not exists book_close_date date;

comment on column public.quickbooks_connections.book_close_date is
  'QuickBooks AccountingInfoPrefs.BookCloseDate, cached at connect/sync. Advisory only — never gate a post on it; it goes stale when the client changes their closing date. Intuit fault 6200/6210 at post time is authoritative.';
