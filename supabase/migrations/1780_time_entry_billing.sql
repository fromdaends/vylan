-- WHAT AN HOUR IS WORTH — the billable side of a time entry (timer v2).
--
-- 1750 froze what an hour COSTS (time_entry_costs, capability-only). This
-- table freezes what the hour would BILL AT: value = duration × the member's
-- billable_rate_hourly, snapshotted at save so a later rate change never
-- rewrites a saved entry's value (the same reasoning as the cost snapshot and
-- engagement_items' price copies).
--
-- THE DOCTRINE THIS SERVES: invoicing stays FLAT per engagement. Value is
-- compared AGAINST the flat fee ("14h 20m · $1,320 value · flat fee $1,100")
-- — it never becomes a line item, never gates billing, and nothing here may
-- ever reach payment_requests.
--
-- ── WHY ITS OWN TABLE, AGAIN ───────────────────────────────────────────────
-- time_entries is firm-readable (shared hours — the founder's standing
-- ruling). A value/rate column there would hand every staff member their
-- colleagues' billable rates by division. Separate table, narrower RLS:
--
--   * your OWN rows — a member may see their own hour's value (it is what the
--     firm charges for them, not what they are paid; the COST rate stays in
--     time_entry_costs, which they cannot read);
--   * everyone's rows — insights.view or rates.manage holders (roles only,
--     the standing rule; owners hold both automatically).
--
-- ── APPLY-TIME NOTE ────────────────────────────────────────────────────────
-- Purely additive. Entries saved before this migration have no billing row and
-- read as "no value recorded" — surfaced, not counted as $0.

create table if not exists public.time_entry_billing (
  time_entry_id uuid primary key
    references public.time_entries(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- Denormalized from the entry so RLS can say "your own row" without a
  -- definer hop on every row read.
  user_id uuid not null references public.users(id) on delete cascade,
  -- The member's billable_rate_hourly (CAD) as it was at SAVE time.
  billable_rate_snapshot numeric(10, 2) not null
    check (billable_rate_snapshot >= 0),
  created_at timestamptz not null default now()
);

create index if not exists time_entry_billing_firm_idx
  on public.time_entry_billing (firm_id);
create index if not exists time_entry_billing_user_idx
  on public.time_entry_billing (user_id);

comment on table public.time_entry_billing is
  'Billable-rate snapshot per time entry (timer v2). Value = duration × this, '
  'compared AGAINST the flat fee — never invoiced. Own-row-or-capability RLS; '
  'absent row = entry predates the migration or the member had no billable '
  'rate, shown as "no value", never $0.';

alter table public.time_entry_billing enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_entry_billing'
      and policyname = 'time_entry_billing_select'
  ) then
    create policy time_entry_billing_select on public.time_entry_billing
      for select using (
        firm_id = public.current_firm_id()
        and (
          user_id = auth.uid()
          or public.current_user_has_capability('insights.view')
          or public.current_user_has_capability('rates.manage')
        )
      );
  end if;

  -- NO WRITE POLICY — deny-all, the time_entry_costs pattern: snapshots are
  -- written by the SERVICE ROLE at save time and are FROZEN. An authenticated
  -- write path would let a session "correct" history, which is the one thing
  -- a snapshot exists to prevent. (Editing an entry's DURATION changes its
  -- value arithmetically; the RATE stays as saved unless the edit path
  -- re-snapshots via service role — the app's call, not a session's.)
end $$;
