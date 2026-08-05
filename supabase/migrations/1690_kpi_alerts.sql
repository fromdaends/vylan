-- KPI alerts — "tell me when this number crosses a line".
--
-- The founder, after Canopy's dashboards article: "built the bell alert thing".
--
-- Canopy's own description: "Monitor changes in Key Performance Indicators
-- (KPIs) with scheduled alerts. Receive notifications for your KPIs on an
-- hourly, daily, weekly, or monthly basis. Create thresholds and indicate
-- whether you want to be notified if it increases, decreases, or changes by a
-- certain percentage." Their dialog is titled "Create alert for 'Open Tasks'"
-- and carries a condition, a threshold value, a check frequency, a name, and a
-- list of subscribers.
--
-- ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
--
-- NOT a second notification system. An alert that fires writes through the
-- SAME notify() every other event in this app goes through, as the catalog
-- event `firm.kpi_alert` — so it obeys per-person preferences, mutes, quiet
-- hours, digests and the email switches without knowing any of them exist.
-- This table stores only the RULE.
--
-- ── WHY THE METRIC IS TEXT AND NOT A VIEW ─────────────────────────────────
--
-- The number is computed in lib/dashboard/work-metrics.ts, in TypeScript, from
-- rows the cron already reads. Re-implementing "overdue" in SQL would mean two
-- definitions of late that could disagree — and the one on screen would not be
-- the one that alerted you. So the database stores which metric to watch, and
-- the same function that draws the card decides what it currently is.
--
-- ── last_fired_at IS THE ANTI-NAG ─────────────────────────────────────────
--
-- A threshold that stays crossed is still crossed tomorrow. Without a memory,
-- a daily check on "open tasks > 100" notifies every single morning until
-- somebody clears the backlog, which trains people to ignore it. So an alert
-- fires on the CROSSING and stays quiet until the value comes back under and
-- crosses again. `last_value` is what makes that decidable.
--
-- Migration number: 1680 is the highest and
--   ls supabase/migrations | sed 's/_.*//' | sort | uniq -d
-- prints nothing, so 1690 is next. RE-RUN THAT CHECK IMMEDIATELY BEFORE
-- MERGING — every collision this repo has had landed in the window between
-- opening a PR and merging it.

create table if not exists kpi_alerts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- Who made it. CASCADE: an alert is a personal watch, and an ownerless one
  -- would keep notifying a list of people nobody can edit.
  user_id uuid not null references users(id) on delete cascade,

  -- Which tab of the Work overview the number lives on.
  surface text not null check (surface in ('tasks', 'engagements')),
  -- Which of the four KPI cards. Text + CHECK rather than an enum so adding a
  -- fifth card is not a type migration.
  metric text not null check (
    metric in ('open', 'overdue', 'completed', 'percent_complete')
  ),

  -- Canopy offers "Greater than / Less than". Stored as a short code so the
  -- label can be translated without a data migration.
  comparator text not null check (comparator in ('gt', 'lt')),
  threshold numeric not null,

  -- How often the cron evaluates it. 'hourly' is accepted but the cron runs
  -- daily today — see the route for why, and why that is honest rather than a
  -- silent downgrade.
  frequency text not null default 'daily'
    check (frequency in ('hourly', 'daily', 'weekly', 'monthly')),

  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Canopy's "Add custom message" checkbox. Optional line carried into the
  -- notification body.
  message text,

  -- Canopy's subscriber chips. Empty means "just me" — resolved at send time
  -- rather than stored as the creator, so removing yourself is possible.
  subscriber_ids uuid[] not null default '{}',

  -- The anti-nag pair. last_value is the reading at the previous check;
  -- last_fired_at is when it last actually notified anyone.
  last_value numeric,
  last_fired_at timestamptz,
  last_checked_at timestamptz,

  created_at timestamptz not null default now()
);

-- The cron's read: every alert in the firm, one query per firm.
create index if not exists kpi_alerts_firm_idx on kpi_alerts (firm_id);
-- The card's read: do I have an alert on this number?
create index if not exists kpi_alerts_mine_idx
  on kpi_alerts (user_id, surface, metric);

-- Two alerts with one name is a notification you cannot trace back to a rule.
create unique index if not exists kpi_alerts_unique_name
  on kpi_alerts (user_id, lower(btrim(name)));

alter table kpi_alerts enable row level security;

-- YOURS ONLY, like saved views. An alert says what you are worried about;
-- a teammate reading your list of them learns more than they should.
drop policy if exists kpi_alerts_select on kpi_alerts;
create policy kpi_alerts_select on kpi_alerts for select
  using (user_id = auth.uid() and firm_id = public.current_firm_id());

drop policy if exists kpi_alerts_write on kpi_alerts;
create policy kpi_alerts_write on kpi_alerts for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id());

revoke all on kpi_alerts from anon, authenticated;
grant select, insert, update, delete on kpi_alerts to authenticated;

comment on table kpi_alerts is
  'A threshold watch on one Work overview KPI. The number itself is computed in TypeScript (lib/dashboard/work-metrics.ts) so the alert and the card can never disagree about what "overdue" means. last_value + last_fired_at make an alert fire on the CROSSING rather than every day the threshold stays crossed.';

-- Verify after applying — expect 0 until somebody creates one:
--   select surface, metric, count(*) from kpi_alerts group by surface, metric;
