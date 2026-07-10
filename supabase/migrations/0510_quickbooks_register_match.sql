-- QuickBooks smart match-or-create — Stage 5 (smart posting, part 3).
--
-- Before creating a transaction for an approved draft, Vylan now searches the
-- POSTED QuickBooks register for the same transaction (amount to the penny,
-- date within a ±5-day window) — the bank feed or the client's bookkeeper may
-- have recorded it first. On a clear match the receipt is ATTACHED to that
-- existing transaction instead of creating a duplicate.
--
-- matched_qbo_type records that a 'posted' draft was MATCHED to an existing
-- QuickBooks transaction rather than created by Vylan, and which entity type it
-- was ('bill' | 'purchase' | 'invoice'). Both facts are load-bearing:
--   * the void (undo) route must UNLINK a matched draft instead of deleting a
--     transaction Vylan never created;
--   * the attach-receipt retry route must target the MATCHED entity type, which
--     can differ from what the draft itself would have posted (e.g. the draft
--     says unpaid Bill but the accountant confirmed a match to a paid Expense).
-- NULL = the normal case: Vylan created the transaction (or nothing is posted).
--
-- Strictly additive + nullable; the app degrades gracefully (isMissingSchema)
-- until this is applied to the remote DB — the register-match step simply skips
-- and posting behaves exactly as before. The table-level SELECT grant (0430)
-- covers this new column for firm members, and writes stay service-role-only.
-- Additive + reversible.

alter table quickbooks_transaction_suggestions
  add column if not exists matched_qbo_type text
    check (matched_qbo_type in ('bill', 'purchase', 'invoice'));
