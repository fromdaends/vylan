-- Relai — onboarding fields on firms.
--
-- Adds the columns the onboarding wizard writes to:
--   * onboarded_at: timestamp when the wizard was completed (any step skipped
--     still counts as "done" — we only need to know whether to redirect to
--     /onboarding on dashboard hit).
--   * invited_emails: stub for the teammate-invite step. Stores raw emails
--     until Resend is wired up in a later phase.
--   * business_hours: free-form jsonb (the spec mentions it; concrete shape
--     can settle later).

alter table firms
  add column if not exists onboarded_at timestamptz,
  add column if not exists invited_emails jsonb not null default '[]'::jsonb,
  add column if not exists business_hours jsonb not null default '{}'::jsonb;

create index if not exists firms_onboarded_idx on firms(onboarded_at);
