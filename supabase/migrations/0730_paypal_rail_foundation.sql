-- PayPal rail foundation (PayPal build, Phase 1 of 5).
--
-- Vylan is adding PayPal (Commerce Platform, partner model) as a SECOND way for
-- clients to pay, alongside Stripe Connect. Same philosophy on both rails: the
-- money goes DIRECTLY from client to the accountant's own account, Vylan never
-- holds funds and takes no fee. This migration adds only the state a second rail
-- needs to coexist with the first; no PayPal behavior ships yet (that's Phases
-- 2-4). Everything is additive; existing Stripe rows and behavior are untouched.
--
-- firms — the firm's PayPal connection, mirroring the stripe_connect_* five
-- (0370/0680) column-for-column in spirit:
--   paypal_merchant_id           the seller's PayPal merchant id, obtained from
--                                Partner Referrals onboarding (Phase 2). The
--                                analog of stripe_connect_account_id.
--   paypal_payments_receivable   PayPal's authoritative "can receive payments"
--                                flag (analog of connect_charges_enabled).
--   paypal_email_confirmed       PayPal requires a confirmed primary email
--                                before the account can receive money; both
--                                flags must be true for the rail to be "ready".
--   paypal_connected_at          stamped once, when the rail first becomes
--                                ready (analog of connect_onboarded_at).
--   paypal_mode                  which PayPal environment the connection was
--                                made in (sandbox vs live) — same dev-shares-
--                                prod-DB clobber protection as
--                                stripe_connect_mode (0680). Null = unknown.
--
-- payment_requests — provider columns so ONE invoice can be paid by either rail:
--   paypal_order_id / paypal_capture_id   PayPal's references (analogs of
--                                         stripe_checkout_session_id /
--                                         stripe_payment_intent_id).
--   paid_provider                which rail actually collected the money,
--                                stamped at the moment the invoice flips paid.
--                                Null = unpaid, or paid before this migration.
--
-- Additive + reversible (down: drop the indexes + columns). Gated: every
-- reader/writer treats a missing column as "no PayPal" / unknown provider, so
-- the app behaves exactly as today until this SQL is applied.

alter table firms
  add column if not exists paypal_merchant_id text,
  add column if not exists paypal_payments_receivable boolean not null default false,
  add column if not exists paypal_email_confirmed boolean not null default false,
  add column if not exists paypal_connected_at timestamptz;
alter table firms
  add column if not exists paypal_mode text
    check (paypal_mode in ('sandbox', 'live'));

-- Forge-proof webhook lookup + one-account-one-firm: resolve a firm by its
-- PayPal merchant id exactly the way the Connect webhook resolves by
-- stripe_connect_account_id (0370). Partial unique (non-null only) so the same
-- merchant id can never be attached to two firms.
create unique index if not exists firms_paypal_merchant_id_key
  on firms (paypal_merchant_id)
  where paypal_merchant_id is not null;

-- DELIBERATELY no `grant update (...)` on any paypal_* column. The firms table
-- has a column-level UPDATE whitelist (0039): by leaving these OUT, they are
-- service-role-write-only — an authenticated user can never PATCH their own
-- paypal_merchant_id to hijack another firm's payments (same protection as the
-- stripe_connect_* columns). SELECT stays table-wide so the UI can read state.

alter table payment_requests
  add column if not exists paypal_order_id text,
  add column if not exists paypal_capture_id text;
alter table payment_requests
  add column if not exists paid_provider text
    check (paid_provider in ('stripe', 'paypal'));

-- Webhook lookup parity with payment_requests_payment_intent_idx (0380).
create index if not exists payment_requests_paypal_order_idx
  on payment_requests (paypal_order_id);

-- Backfill: every invoice paid before this migration was necessarily paid via
-- Stripe (the only rail that existed). Stamp it so history reads correctly.
-- Scoped to rows carrying a Stripe reference as a belt-and-braces guard.
update payment_requests
  set paid_provider = 'stripe'
  where status = 'paid'
    and paid_provider is null
    and (stripe_payment_intent_id is not null
      or stripe_checkout_session_id is not null);
