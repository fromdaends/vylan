-- AI monthly cap — auto-pause the client-document AI check after a firm hits
-- its monthly quota, to bound token spend.
--
-- After `ai_monthly_cap` (default 400) client document AI checks in a calendar
-- month (UTC), the classifier auto-skips for the rest of the month; uploads +
-- everything else keep working. The counter naturally resets next month (a new
-- period_month row starts at 0). The accountant sees the count in Settings.

------------------------------------------------------------------------------
-- firms.ai_monthly_cap — per-firm cap. Service-role-only, mirroring
-- seat_cap_override (0190): deliberately NOT added to the authenticated UPDATE
-- column whitelist (0039/0059), so a client PATCH can't raise its own cap.
------------------------------------------------------------------------------
alter table firms
  add column if not exists ai_monthly_cap integer not null default 400;

alter table firms
  drop constraint if exists firms_ai_monthly_cap_check;
alter table firms
  add constraint firms_ai_monthly_cap_check check (ai_monthly_cap >= 0);

comment on column firms.ai_monthly_cap is
  'Max client-document AI checks per calendar month (UTC) before the AI pipeline auto-pauses for the rest of the month. Default 400. Service-role-only (excluded from the authenticated UPDATE whitelist).';

------------------------------------------------------------------------------
-- ai_usage_monthly — durable per-firm monthly meter. One row per firm per UTC
-- month; absence = 0 used. Hot-path gate read is the PK point-lookup.
------------------------------------------------------------------------------
create table if not exists ai_usage_monthly (
  firm_id uuid not null references firms(id) on delete cascade,
  period_month date not null,           -- date_trunc('month', utc)::date
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (firm_id, period_month)
);

-- RLS: firm members may READ their own firm's usage (for the Settings display).
-- Writes go only through the increment function below (service-role worker),
-- so no insert/update policy is granted to `authenticated`.
alter table ai_usage_monthly enable row level security;
revoke all on ai_usage_monthly from anon, authenticated;
grant select on ai_usage_monthly to authenticated;

drop policy if exists ai_usage_monthly_select on ai_usage_monthly;
create policy ai_usage_monthly_select on ai_usage_monthly for select
  using (firm_id = public.current_firm_id());

------------------------------------------------------------------------------
-- Atomic increment — one row per firm/month, +1 each time an AI check runs.
-- security definer so the service-role worker can call it; it does its own
-- firm-scoping via the passed id.
------------------------------------------------------------------------------
create or replace function public.increment_ai_usage(p_firm_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into ai_usage_monthly (firm_id, period_month, used)
  values (p_firm_id, date_trunc('month', (now() at time zone 'utc'))::date, 1)
  on conflict (firm_id, period_month)
  do update set used = ai_usage_monthly.used + 1, updated_at = now()
  returning used;
$$;
