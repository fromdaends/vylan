-- Invoice at engagement creation + the deliverables lock (feature: invoicing at
-- engagement start + Final documents lock).
--
-- Evolves the existing payment_requests "invoice" so that ONE invoice per
-- engagement can be created at engagement CREATION (or any time after), not only
-- at completion. This migration adds the small amount of state that needs a
-- column; the "create it now" behavior itself is code (see createEngagementAction
-- + lib/invoices/create.ts).
--
--   payment_requests.locks_deliverables  the invoice, when unpaid, gates ONLY the
--                                         engagement's Final documents section
--                                         (deliverables the accountant sends back
--                                         to the client). It NEVER gates uploads,
--                                         signing, or signed-document access.
--                                         Enforcement lands in a later phase; this
--                                         records the accountant's choice now.
--   payment_requests.override_unlocked    accountant's manual "unlock without
--                                         payment" (comped / paid by cheque). When
--                                         true, Final documents are unlocked even
--                                         though the invoice is still unpaid.
--
--   engagements.invoice_locks_deliverables the lock PREFERENCE captured at setup,
--                                          so an invoice created LATER by the
--                                          automation (on_completion / delayed)
--                                          carries the same lock. The invoice row
--                                          (payment_requests.locks_deliverables) is
--                                          always the source of truth for gating.
--   engagements.invoice_description        optional description carried onto the
--                                          invoice, whichever timing creates it.
--
-- Neither engagements nor payment_requests is under the per-column UPDATE lockdown
-- (0039 locked only users + firms), so no grant is needed. Additive + reversible
-- (down: drop the columns). Gated: every reader/writer treats a missing column as
-- the safe default (not locked / no description), so the app behaves exactly as
-- today until the SQL is applied.

alter table payment_requests
  add column if not exists locks_deliverables boolean not null default false;
alter table payment_requests
  add column if not exists override_unlocked boolean not null default false;

alter table engagements
  add column if not exists invoice_locks_deliverables boolean not null default false;
alter table engagements
  add column if not exists invoice_description text;
