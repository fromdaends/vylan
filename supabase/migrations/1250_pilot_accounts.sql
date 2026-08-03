-- Pilot accounts (migration 1250).
--
-- A pilot is a comped, time-boxed evaluation account handed to a firm whose
-- feedback we want. It needs one half of each state that already existed:
--
--   free trial (is_demo, no subscription)
--     -> TRIAL_AI_TOTAL_CAP AI checks for the LIFETIME of the account
--        (deliberately ~10: enough to evaluate, not to run a practice)
--     -> trial_ends_at gates write actions once it passes
--
--   paid (is_demo = false)
--     -> ai_monthly_cap AI checks per calendar month
--     -> no clock at all; the account never ends by itself
--
-- A pilot wants the monthly meter (so the firm can genuinely use the product
-- for months and tell us what breaks) AND the clock (so the pilot ends by
-- itself instead of quietly becoming a free account forever). is_pilot is
-- exactly that switch: it moves the firm off the lifetime ceiling onto the
-- monthly meter and changes nothing else. is_demo and trial_ends_at are left
-- alone, so the end-of-pilot gate still fires on schedule.
--
-- Ordinary trials are untouched: the column defaults to false, and
-- isTrialCapped() only consults it for firms that are already is_demo.
--
-- Service-role only. Deliberately NOT added to the updateCurrentFirm
-- whitelist in src/lib/db/firms.ts — a firm must never be able to promote
-- itself to a pilot and lift its own AI ceiling.

alter table public.firms
  add column if not exists is_pilot boolean not null default false;

comment on column public.firms.is_pilot is
  'Comped pilot account: metered by ai_monthly_cap per calendar month instead of the trial lifetime cap, while is_demo + trial_ends_at still end the pilot on schedule. Service-role only.';
