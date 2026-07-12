-- Invoice automation (phase 5).
--
-- Lets an accountant have the client's invoice (a payment_request) sent
-- automatically when an engagement finishes, instead of clicking "Request
-- payment" by hand. Per engagement:
--   invoice_auto_mode   'off'          = manual, today's behavior (default)
--                       'on_completion'= send the invoice the moment the
--                                        engagement is marked complete
--                       'delayed'      = send it invoice_delay_days days after
--                                        completion (via the jobs queue)
--   invoice_delay_days  the N for 'delayed' (NULL / ignored otherwise)
--   invoice_amount_cents the amount to bill, captured at setup (from the firm's
--                        default service price or a custom value the accountant
--                        entered), so the automatic send knows what to charge.
--
-- Firms carry a DEFAULT that pre-selects the choice on every new engagement
-- (still editable per engagement):
--   default_invoice_auto_mode / default_invoice_delay_days
--
-- engagements is NOT under the per-column UPDATE lockdown (0039 locked only
-- users + firms), so the builder's session client writes the engagement columns
-- with no extra grant. The firm-default columns DO need a column grant (like
-- service_prices); they are an owner preference, owner-checked in the settings
-- route. Auto-sending still requires the firm to have Stripe Connect charges
-- enabled; the send path no-ops otherwise.
--
-- Additive + reversible (down: drop the columns). Gated: every reader/writer
-- treats a missing column as "off" / no automation, so the app behaves exactly
-- as today until the SQL is applied.

alter table engagements
  add column if not exists invoice_auto_mode text not null default 'off'
    check (invoice_auto_mode in ('off', 'on_completion', 'delayed'));
alter table engagements
  add column if not exists invoice_delay_days integer;
alter table engagements
  add column if not exists invoice_amount_cents bigint
    check (invoice_amount_cents is null or invoice_amount_cents > 0);

alter table firms
  add column if not exists default_invoice_auto_mode text not null default 'off'
    check (default_invoice_auto_mode in ('off', 'on_completion', 'delayed'));
alter table firms
  add column if not exists default_invoice_delay_days integer;

-- Owner preference, edited via /api/firm/invoice-defaults (owner-checked).
-- Mirrors the service_prices column grant.
grant update (default_invoice_auto_mode, default_invoice_delay_days)
  on public.firms to authenticated;

-- Mark AUTOMATED payment requests so we can enforce "at most one live auto
-- invoice per engagement" WITHOUT blocking the manual "request payment again"
-- flow (which legitimately makes several requests per engagement). Written only
-- by the service-role create path (createPaymentRequestSR); the manual path
-- leaves it false.
alter table payment_requests
  add column if not exists auto boolean not null default false;

-- Atomic double-send backstop: two concurrent auto-sends (a double-clicked
-- "Mark complete", or two delayed jobs drained in the same cron wave) both pass
-- the application-level "already invoiced?" check and both try to insert. This
-- partial unique index makes the SECOND insert fail (23505), which the code
-- treats as "already sent" — so a client can never be auto-billed twice.
-- Partial (excludes cancelled) so a NEW auto invoice is allowed after a prior
-- one is cancelled; scoped to auto=true so manual requests stay unconstrained.
create unique index if not exists payment_requests_auto_active_uniq
  on payment_requests (engagement_id)
  where auto and status <> 'canceled';
