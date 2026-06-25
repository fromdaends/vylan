-- QuickBooks transaction suggestions — Stage 5, Phase 1 (the FIRST WRITE to QBO).
--
-- Records the result of POSTING an approved draft to QuickBooks so we never
-- double-post and can undo (void). Everything is additive + nullable so the app
-- degrades gracefully until this is applied to the remote DB (the code refuses
-- to call the QuickBooks create endpoint unless these columns exist, so a post
-- can ALWAYS be recorded — no post-without-record / double-post window).
--
--   posted_qbo_id          — the Intuit transaction Id returned on a successful
--                            post (null until posted). Indexed for reconciliation.
--   posted_qbo_sync_token  — the Intuit SyncToken of the posted transaction,
--                            required to void it later.
--   post_attempt           — bumped each time the draft is voided + re-posted, so
--                            the idempotency requestid (fileId-attempt) is fresh
--                            after an undo (a reused requestid would return the
--                            old/voided transaction instead of creating a new one).
--   posted_at / posted_by  — when + who posted (distinct from reviewed_by/at,
--                            which track the approval).
--   post_error             — the QuickBooks error from the last failed attempt
--                            (null on success / never-attempted); the draft stays
--                            'approved' so it can be fixed and retried.
--
-- Status gains a 'posted' state (free-form text column; normalizeDraftStatus in
-- the app coerces unknowns to 'draft', so older readers stay safe). Writes remain
-- service-role-only; the existing table-level SELECT grant from 0430 covers these
-- new columns for firm members. Additive + reversible.

alter table quickbooks_transaction_suggestions
  add column if not exists posted_qbo_id text,
  add column if not exists posted_qbo_sync_token text,
  add column if not exists post_attempt smallint not null default 0,
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by uuid references auth.users(id),
  add column if not exists post_error text;

create index if not exists qbo_tx_suggestions_posted_idx
  on quickbooks_transaction_suggestions (posted_qbo_id);
