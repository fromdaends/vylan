-- Free trial: give existing unconverted demo/trial firms a fresh 14-day clock.
--
-- New signups get trial_ends_at at firm-creation time (see onboarding step 1).
-- This backfills any firm that is still on the (unconverted) free trial
-- — is_demo = true — but never had a clock, so the day-14 "book a meeting"
-- gate has a date to work from. Fresh 14 days from when this runs.
--
-- Paid / live firms (is_demo = false) are left untouched, and any trial firm
-- that somehow already has a clock keeps it.
update public.firms
set trial_ends_at = now() + interval '14 days'
where is_demo = true
  and trial_ends_at is null;
