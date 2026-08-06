-- Recurring service lines become real invoices, one per period.
--
-- ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
--
-- A billing block could say "$400/month" (billing-blocks.ts), the totals panel
-- grouped by frequency, and the client's proposal printed "$400 monthly" — and
-- then the engagement was invoiced exactly ONCE. `engagement_items.billing_
-- frequency` was read for DISPLAY only. A client could agree to pay monthly and
-- never be asked for the second month.
--
-- Precisely the shape of the deposit bug 1680 fixed: a promise on the proposal
-- with nothing behind it that could charge.
--
-- ── THE INVARIANT THIS CHANGES, AND WHY ────────────────────────────────────
--
-- 1680 rebuilt the live-invoice index as (engagement_id, kind): one live
-- invoice per engagement per kind. That is still right for the two charges it
-- knew about — the deposit, and the final bill — because each happens once.
--
-- A recurring charge happens every period, on the SAME engagement, and each
-- period is a genuinely separate invoice the client pays separately. So the key
-- gains a third axis: (engagement_id, kind, billing_period).
--
--   kind='engagement', billing_period=null    -> the job's invoice   (unchanged)
--   kind='deposit',    billing_period=null    -> due on acceptance   (unchanged)
--   kind='recurring',  billing_period='2026-08' -> August's charge     (new)
--   kind='recurring',  billing_period='2026-09' -> September's charge  (new)
--
-- `billing_period` is NULL on every existing row and coalesced to '' in the
-- index, so the two existing kinds keep enforcing exactly what they enforce
-- today. Nothing about a deposit or a final bill changes.
--
-- ── APPLY-TIME CHECK ───────────────────────────────────────────────────────
--
-- The index is rebuilt, not added. It cannot fail on existing data (the old key
-- is a prefix of the new one, so anything the old index permitted the new one
-- permits), but check anyway:
--
--   select engagement_id, kind, coalesce(billing_period, ''), count(*)
--   from public.payment_requests
--   where engagement_id is not null and status <> 'canceled'
--   group by 1, 2, 3 having count(*) > 1;
--
-- Must return no rows.

-- ── 1. Which period a charge is for ────────────────────────────────────────

alter table public.payment_requests
  add column if not exists billing_period text;

comment on column public.payment_requests.billing_period is
  'For kind=''recurring'': the period this invoice bills (2026-08, 2026-Q3, '
  '2026-W32, 2026). NULL for the one-off kinds, which have no period.';

comment on column public.payment_requests.kind is
  'engagement = the job''s invoice (0610 behaviour). deposit = the amount due '
  'when the client accepted the proposal (1680). recurring = one period of an '
  'ongoing arrangement (1710), discriminated by billing_period.';

-- One live invoice per engagement, per kind, PER PERIOD. Created first,
-- dropped second, so there is no window in which neither is enforcing.
create unique index if not exists payment_requests_engagement_kind_period_uniq
  on public.payment_requests (engagement_id, kind, coalesce(billing_period, ''))
  where status <> 'canceled';

drop index if exists public.payment_requests_engagement_kind_uniq;

-- ── 2. The schedule ────────────────────────────────────────────────────────
--
-- One row per engagement that has recurring lines. Not per line: a client who
-- agreed to three monthly services gets ONE monthly invoice listing all three,
-- which is what a firm sends and what the proposal's own totals panel shows.
-- An engagement with monthly AND quarterly lines therefore has two schedules,
-- which is correct — they bill on different days for different amounts.

create table if not exists public.engagement_billing_schedules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,

  -- Mirrors BLOCK_FREQUENCIES / CHARGE_FREQUENCIES. 'once' is absent by
  -- design: a line that bills once is not on a schedule at all.
  frequency text not null check (frequency in ('weekly','monthly','quarterly','yearly')),
  -- Day of month the charge lands on, clamped per-month in code (a day-31
  -- schedule bills Feb 28 and then Mar 31 again). Ignored when weekly.
  anchor_day integer not null default 1 check (anchor_day between 1 and 31),

  next_charge_on date not null,
  -- When the arrangement stops. NULL = ongoing, which is the common case.
  ends_on date,
  status text not null default 'active' check (status in ('active','paused','ended')),

  -- What the client sees on the line. The rate itself is read LIVE from
  -- engagement_items at charge time rather than frozen here, so a price change
  -- takes effect from the next period — the way an ongoing arrangement works.
  -- Invoices already raised are untouched, because they are already raised.
  description text,

  created_at timestamptz not null default now(),
  ended_at timestamptz,

  -- One schedule per engagement per frequency. Re-running the setup after an
  -- acceptance (or a retry) can never produce two schedules that both bill.
  unique (engagement_id, frequency)
);

comment on table public.engagement_billing_schedules is
  'Makes "$400/month" on a proposal true — one invoice per period per engagement. '
  'Amounts are read live from engagement_items; see lib/billing/charge-recurring.';

create index if not exists engagement_billing_schedules_due_idx
  on public.engagement_billing_schedules (next_charge_on)
  where status = 'active';

create index if not exists engagement_billing_schedules_engagement_idx
  on public.engagement_billing_schedules (engagement_id);

-- ── 3. The ledger ──────────────────────────────────────────────────────────
--
-- Same design as recurring_occurrences, for the same reason: the UNIQUE key is
-- the idempotency guarantee, enforced by the database rather than by careful
-- code. Under cron overlap, a retry, or a manual charge racing the schedule,
-- exactly one insert can win.
--
-- Deliberately NOT derived from payment_requests: an accountant who CANCELS a
-- period's invoice has made a decision, and a cancelled row leaves the partial
-- index. If the ledger were the invoice table, the next cron run would read
-- that as "never billed" and raise it again.

create table if not exists public.engagement_billing_charges (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.engagement_billing_schedules(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  period_key text not null,
  payment_request_id uuid references public.payment_requests(id) on delete set null,
  created_at timestamptz not null default now(),

  unique (schedule_id, period_key)
);

comment on table public.engagement_billing_charges is
  'One row per period already billed. The unique key IS the never-bill-twice '
  'guarantee; a cancelled invoice does not un-burn its period.';

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
--
-- Firm-scoped reads for the accountant, following the pattern every other
-- firm-owned table here uses. Writes are service-role only (the cron and the
-- acceptance hook), so there is no insert/update/delete policy — service role
-- bypasses RLS and nobody else has any business writing a billing schedule.

alter table public.engagement_billing_schedules enable row level security;
alter table public.engagement_billing_charges enable row level security;

drop policy if exists engagement_billing_schedules_select on public.engagement_billing_schedules;
create policy engagement_billing_schedules_select
  on public.engagement_billing_schedules for select
  using (
    firm_id in (select firm_id from public.users where id = auth.uid())
  );

drop policy if exists engagement_billing_charges_select on public.engagement_billing_charges;
create policy engagement_billing_charges_select
  on public.engagement_billing_charges for select
  using (
    firm_id in (select firm_id from public.users where id = auth.uid())
  );
