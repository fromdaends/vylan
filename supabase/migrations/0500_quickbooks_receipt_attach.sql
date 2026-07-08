-- QuickBooks receipt-attach tracking — Stage 5 (smart posting, part 1 follow-up).
--
-- PR #675 attaches the source receipt to a posted QuickBooks transaction as a
-- best-effort step right after the post. Until now that outcome was INVISIBLE and
-- UNRECOVERABLE: a failed or skipped attach only logged to the server, and because
-- the draft is already 'posted' a re-run short-circuits at the already-posted
-- guard BEFORE the attach — so a receipt that missed (unsupported type, a >10s
-- timeout, a storage hiccup, a mid-batch route timeout) could NEVER be re-attached
-- without voiding + re-posting the whole transaction.
--
-- receipt_attached_at records WHEN the source receipt was successfully attached to
-- the posted transaction (null = not attached yet / attach failed / not posted).
-- The card shows "Receipt attached" when it is set, and offers a one-click "Attach
-- receipt" retry when a posted draft still has it null. Strictly additive +
-- nullable; the app degrades gracefully (isMissingSchema) until this is applied to
-- the remote DB, so posting + attach keep working exactly as before in the
-- meantime. The table's table-level SELECT grant (0430) covers this new column for
-- firm members, and writes stay service-role-only. Additive + reversible.

alter table quickbooks_transaction_suggestions
  add column if not exists receipt_attached_at timestamptz;
