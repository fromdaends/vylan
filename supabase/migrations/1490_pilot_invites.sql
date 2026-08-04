-- Pilot invites (migration 1490).
--
-- migration 1250 gave us the pilot ACCOUNT state (metered monthly through
-- ai_monthly_cap, while is_demo + trial_ends_at still end it on schedule).
-- Turning it on was still a manual database edit after the fact, which means
-- someone has to notice the firm signed up and remember to go flip it. In the
-- window before that happens the pilot firm is an ordinary trial, capped at ten
-- AI checks for its lifetime — the pilot hits the ceiling on day one and reports
-- it as a bug.
--
-- This table closes that window. Pre-authorise an email BEFORE the firm exists;
-- onboarding checks it at the moment it creates the firm and applies the pilot
-- terms inline. Nobody has to be watching when they sign up.
--
-- The clock starts at SIGNUP rather than at pre-authorisation, which is what you
-- actually want: a pilot invited today and taking three weeks to get around to
-- signing up still gets their full pilot_days, not the remainder.
--
-- Service-role only. RLS is enabled with NO policies, which is deny-all for
-- anon and authenticated: the pilot terms of an account must not be readable or
-- writable by the account itself. Only the server-side service-role path (which
-- bypasses RLS) touches this.

create table if not exists public.pilot_invites (
  -- Lower-cased so the onboarding lookup can match without a functional index,
  -- and the constraint stops a mixed-case row from silently never matching.
  email text primary key check (email = lower(email)),
  -- AI document checks per calendar month once redeemed. Copied onto
  -- firms.ai_monthly_cap.
  ai_monthly_cap integer not null default 50 check (ai_monthly_cap >= 0),
  -- Pilot length. Counted from the signup instant, not from this row's
  -- created_at.
  pilot_days integer not null default 90 check (pilot_days > 0),
  -- Free-text, for whoever reads this table in six months wondering who this is.
  note text,
  -- Stamped when a signup consumes the invite, so it is visible which invites
  -- are outstanding and one invite cannot quietly furnish two firms.
  redeemed_at timestamptz,
  redeemed_firm_id uuid references public.firms(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.pilot_invites enable row level security;

comment on table public.pilot_invites is
  'Emails pre-authorised for a pilot account. Read by onboarding at firm-creation time to apply is_pilot + ai_monthly_cap + a pilot-length trial_ends_at. Service-role only: RLS is on with no policies (deny-all).';
