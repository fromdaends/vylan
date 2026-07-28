-- 0940_recurring_series_assignee.sql
--
-- BUG FIX: a removed teammate keeps being assigned brand-new work, forever.
--
-- recurring_series has no assignee at all. The spawner hardcodes
-- `assigned_user_id: series.created_by_user_id` on every engagement it
-- creates (src/lib/recurring/spawn.ts). So when a teammate is removed,
-- guarded offboarding (0880-era deactivateUser) reassigns their live
-- engagements + clients but CANNOT touch their schedules — and the series
-- keeps minting new work assigned to a deactivated user every single cycle.
--
-- Second half of the same bug: the Remove dialog decides whether to even
-- OFFER a handover by counting engagements + clients only. Someone whose
-- entire footprint is recurring schedules reports as holding nothing, so the
-- owner gets a plain "Remove" button and is never asked where the work goes.
--
-- Fix: give a series a real, changeable owner. Backfilled from
-- created_by_user_id so every existing schedule keeps its current behaviour
-- exactly — this migration changes no spawn outcome on its own.

alter table public.recurring_series
  add column if not exists assigned_user_id uuid
    references public.users(id) on delete set null;

-- Backfill = today's behaviour, made explicit. Idempotent: only fills nulls.
update public.recurring_series
   set assigned_user_id = created_by_user_id
 where assigned_user_id is null
   and created_by_user_id is not null;

-- Offboarding's lookup: "this person's still-running schedules in this firm".
-- Partial — an ended series can never spawn again, so it never needs handing
-- over and shouldn't be counted against the departing member.
create index if not exists recurring_series_assignee_idx
  on public.recurring_series (firm_id, assigned_user_id)
  where status <> 'ended';

comment on column public.recurring_series.assigned_user_id is
  'Who new engagements spawned from this series are assigned to. Backfilled from created_by_user_id (0940). Reassigned by guarded offboarding; the spawner falls back to an active firm owner when this user has been deactivated.';
