-- TIME TRACKING IS ON FOR EVERYONE — new signups included.
--
-- 1750 shipped it behind firms.time_insights_enabled defaulting FALSE, per the
-- build spec's "everything behind the flag until explicitly enabled". The
-- founder, on seeing it live: "does it not work for every firm that signs up?"
-- — which is that explicit enablement, made general. So:
--
--   * the column DEFAULT flips to true — every firm created after this starts
--     with time tracking available;
--   * every EXISTING firm is switched on — demo and trial firms included,
--     deliberately: a trial that hides a live feature is underselling the
--     product to the exact person deciding whether to pay.
--
-- The column STAYS. It is no longer a rollout gate but an off switch: support
-- can still turn the feature off for one firm without a deploy, and
-- isTimeInsightsEnabled() keeps its only-explicit-true-is-on read, which now
-- simply always finds true unless someone chose otherwise.
--
-- Idempotent and safe to re-run: the default is a plain redefinition and the
-- update only touches rows still false.

alter table public.firms
  alter column time_insights_enabled set default true;

update public.firms
  set time_insights_enabled = true
  where time_insights_enabled is distinct from true;

comment on column public.firms.time_insights_enabled is
  'Time tracking + Insights. Default TRUE since 1770 (founder: on for every '
  'firm that signs up); false is a per-firm off switch, not a rollout gate.';
