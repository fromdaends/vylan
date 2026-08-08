-- HOURS BELONG ON THE LINE, NOT ONLY IN THE CATALOGUE (1820)
--
-- Founder, looking at a service template beside the engagement that used it:
-- "when you're actually creating a service item, you could see there's a huge
-- difference between the rate per item per hour and versus, like, the billable
-- hours and stuff. so make sure you add that on to service items and while
-- creating an engagement as well."
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
--
-- 1790 put `budget_minutes` on firm_services only, and engagement-board.ts
-- builds a job's budget by reaching THROUGH each line to the catalogue entry it
-- came from. That works exactly as long as every line came from the catalogue.
--
-- It does not. A hand-typed line ("Not from your catalogue") has no service_id,
-- so it reaches nothing and contributes ZERO hours — silently, with nothing on
-- screen saying so. Its actual tracked time still lands in Actual. So the
-- capacity strip's "Remaining" flattered the firm by exactly the hours nobody
-- could enter, and the fuller the engagement of bespoke work, the bigger the
-- lie.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- The line gets its own duration. Picking a catalogue service SEEDS it (same
-- copy-not-link rule as the price — see engagement-items-editor's chooseService),
-- and it is editable afterwards, because "this T1 is a two-hour job for most
-- clients and a six-hour job for this one" is the ordinary case.
--
-- NULL keeps 1790's meaning exactly: nobody has said, and it contributes
-- NOTHING to a budget rather than zero. resolveBudgetMinutes already treats an
-- empty list that way, so an untouched firm sees "—" and not "0h".
alter table public.engagement_items
  add column if not exists budget_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'engagement_items_budget_minutes_check'
  ) then
    alter table public.engagement_items
      add constraint engagement_items_budget_minutes_check
      check (budget_minutes is null or budget_minutes >= 0);
  end if;
end $$;

comment on column public.engagement_items.budget_minutes is
  'How long this line is expected to take, in minutes. Seeded from the picked '
  'firm_services.budget_minutes and editable per engagement. NULL = nobody has '
  'said; contributes nothing to a budget rather than zero (1820).';

-- No RLS change. engagement_items already inherits the engagement''s policies,
-- and this column is neither more nor less sensitive than the rate beside it.
