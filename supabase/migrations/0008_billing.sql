-- Phase 10: billing fields on firms.
--
-- We already have stripe_customer_id and plan. Adding:
--   * stripe_subscription_id  — the active subscription if any
--   * subscription_status     — Stripe's status verbatim
--                               (trialing, active, past_due, canceled, etc.)
--   * current_period_end      — when the current billing period ends
--   * trial_ends_at           — 14-day trial cutoff set on signup
--   * users_limit (denormalized for convenience; updated by webhook on plan change)

alter table firms
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists trial_ends_at timestamptz;

-- Backfill trial_ends_at for existing firms (14 days from creation).
update firms
  set trial_ends_at = created_at + interval '14 days'
  where trial_ends_at is null;
