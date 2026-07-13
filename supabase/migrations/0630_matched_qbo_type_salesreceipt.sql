-- QuickBooks Sales Receipt — widen the matched_qbo_type CHECK constraint.
--
-- 0510 added quickbooks_transaction_suggestions.matched_qbo_type with a CHECK
-- limited to ('bill', 'purchase', 'invoice'). The Sales Receipt feature lets a
-- PAID income draft post a QuickBooks SalesReceipt, and the smart match-or-create
-- flow can now MATCH an already-posted SalesReceipt (bank feed / bookkeeper got
-- there first) and record matched_qbo_type = 'salesreceipt'. Without this, that
-- write raises a CHECK violation (SQLSTATE 23514) — which is NOT a missing-schema
-- error, so the app's graceful-degrade retry can't recover and the match sticks
-- in a permanent record_failed. Widen the allowed set to include 'salesreceipt'.
--
-- Freshly-CREATED SalesReceipts are unaffected either way (they record
-- matched_qbo_type = NULL); this only unblocks the match-to-existing path for
-- paid income. Must be applied before paid-income smart-match can attach to an
-- existing SalesReceipt.
--
-- Drop the OLD constraint by looking it up in the catalog rather than assuming
-- its auto-generated name: if the name were even slightly off, a `drop ... if
-- exists` on a guessed name would silently no-op and leave the narrow constraint
-- in place, so the widened one below would be a no-op and the bug would persist.
-- Idempotent + reversible.

do $$
declare
  old_name text;
begin
  select conname
    into old_name
  from pg_constraint
  where conrelid = 'quickbooks_transaction_suggestions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%matched_qbo_type%';

  if old_name is not null then
    execute format(
      'alter table quickbooks_transaction_suggestions drop constraint %I',
      old_name
    );
  end if;
end $$;

alter table quickbooks_transaction_suggestions
  add constraint quickbooks_transaction_suggestions_matched_qbo_type_check
    check (matched_qbo_type in ('bill', 'purchase', 'invoice', 'salesreceipt'));
