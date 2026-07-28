-- Xero — choose how a bill lands: Draft / Awaiting approval / Awaiting payment.
--
-- Hubdoc lets the accountant pick this per document and per supplier. We only
-- ever produced Xero's AUTHORISED ("Awaiting payment") or DRAFT, so a firm
-- running an approval workflow (ApprovalMax and friends) had no way to land a
-- bill in "Awaiting approval" — Xero's SUBMITTED — and our bills bypassed their
-- approval process entirely.
--
-- Two columns, for two different jobs.
--
-- 1. xero_connections.default_publish_status — this CLIENT's remembered choice.
--    Client scope, not firm: approval workflow is an org-level policy, and a
--    firm will have some clients on ApprovalMax and some not. Non-secret, so it
--    joins the 0740 column-grant whitelist (reads by firm members, writes stay
--    service-role).
--
-- 2. quickbooks_transaction_suggestions.posted_status — what we ACTUALLY sent.
--    This one is not a preference, it is a safety record. Undo resolves its
--    Xero call from this: Xero REJECTS the VOIDED transition on a DRAFT or
--    SUBMITTED invoice (the legal move there is DELETED), so an undo that
--    re-derives the status from today's draft state would throw, leave the bill
--    sitting in Xero, and strand the row as "posted" in Vylan with no way back
--    except deleting it by hand in Xero. Nullable on purpose: rows posted
--    before this migration have no record, and null means "AUTHORISED", which
--    is exactly what those rows were.
--
-- Additive + reversible (down: drop both columns).

alter table xero_connections
  add column if not exists default_publish_status text not null
    default 'AUTHORISED'
    check (default_publish_status in ('DRAFT', 'SUBMITTED', 'AUTHORISED'));

-- Extend 0740's non-secret column whitelist. The token columns stay unreadable.
grant select (default_publish_status) on xero_connections to authenticated;

alter table quickbooks_transaction_suggestions
  add column if not exists posted_status text
    check (posted_status is null
           or posted_status in ('DRAFT', 'SUBMITTED', 'AUTHORISED'));

-- Verify after applying:
--   select column_name from information_schema.columns
--    where table_name = 'xero_connections' and column_name = 'default_publish_status';
--   select column_name from information_schema.columns
--    where table_name = 'quickbooks_transaction_suggestions' and column_name = 'posted_status';
