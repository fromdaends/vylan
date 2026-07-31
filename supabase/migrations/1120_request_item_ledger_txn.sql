-- Which transaction in the client's books this request is chasing a receipt for.
--
-- Vylan's document flow has always run one way: a document arrives and BECOMES a
-- transaction. The receipt chase runs the other way — we already know the
-- transaction, and what is missing is the paper behind it. So a request item
-- needs to remember which entry in the ledger it is about, or the receipt that
-- comes back has no idea where to go and would post a SECOND transaction for an
-- expense already in the books. That is the exact double-count the register
-- matcher exists to prevent, and this column is what stops it arising at all.
--
-- ONE JSONB COLUMN, not six typed ones. The reference needs the provider, the
-- entity type, the id, and enough context to show a human what is being chased
-- (amount, currency, date, supplier). Those travel together, are written once
-- and never queried individually, and a second provider will want a slightly
-- different shape — which is the case jsonb is for. The repo already stores
-- exactly this kind of payload as jsonb (quickbooks_transaction_suggestions
-- .suggestion / .resolved).
--
-- Shape written today:
--   {
--     "provider": "quickbooks",       -- 'quickbooks' | 'xero'
--     "entity":   "bill",             -- 'bill' | 'purchase'
--     "txnId":    "195",
--     "amount":   169.5,
--     "currency": "CAD",              -- null in a single-currency company
--     "txnDate":  "2026-07-30",
--     "vendorName": "Boreal Traiteur & Evenements inc."
--   }
--
-- NULLABLE WITH NO DEFAULT. Null means "an ordinary request for a document",
-- which is every request item that exists today and most that will ever exist.
-- Only the receipt chase writes it, and every reader treats null as "not chasing
-- anything" — so an unapplied migration degrades to today's behaviour rather
-- than breaking the checklist.
--
-- No new grant needed: request_items is already firm-scoped and readable by the
-- portal's own path; this column carries no more sensitivity than the label,
-- which already says what is being asked for.
--
-- Additive + reversible (down: drop the column).

alter table request_items
  add column if not exists ledger_txn jsonb;

comment on column request_items.ledger_txn is
  'When set, this request is chasing the receipt for an existing transaction in the client''s bookkeeping ledger. The returned document ATTACHES to that transaction rather than creating a new one.';

-- Verify after applying:
--   select id, label, ledger_txn from request_items where ledger_txn is not null;
--
-- Expect zero rows until the first receipt chase is sent.
