-- Stripe Connect (Standard) — Phase 2 of the payments feature.
--
-- Lets each firm connect their OWN Stripe account so clients can pay the
-- accountant DIRECTLY (direct charges). Vylan never holds funds and never
-- stores bank/card data; these columns only track the connected-account id and
-- Stripe's authoritative onboarding/capability flags. The flags are written
-- ONLY by the Connect webhook (service role) from Stripe's account.updated
-- event — never trusted from the browser or the onboarding redirect.
--
-- Additive + reversible (down: drop the index + columns).

alter table firms
  add column if not exists stripe_connect_account_id text,
  add column if not exists connect_charges_enabled boolean not null default false,
  add column if not exists connect_payouts_enabled boolean not null default false,
  add column if not exists connect_details_submitted boolean not null default false,
  add column if not exists connect_onboarded_at timestamptz;

-- Forge-proof webhook lookup: resolve a firm by its connected-account id the
-- same way the subscription webhook resolves by stripe_customer_id. Partial
-- unique index (non-null only) so one Stripe account maps to exactly one firm
-- and the same acct_ can never be attached to two firms.
create unique index if not exists firms_stripe_connect_account_id_key
  on firms (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

-- DELIBERATELY no `grant update (...)` on these columns. The firms table has a
-- column-level UPDATE whitelist (0039_lock_down_column_updates): authenticated
-- members may only UPDATE explicitly granted columns. By leaving these OUT of
-- the whitelist they are service-role-write-only — an authenticated user can
-- never PATCH their own stripe_connect_account_id to hijack another firm's
-- payouts (same protection that guards stripe_customer_id / plan). SELECT stays
-- table-wide, so getCurrentFirm() can read the connected/ready state for the UI.
