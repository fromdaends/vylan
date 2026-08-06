-- TIME TRACKING, COST RATES, AND THE LINE BETWEEN THEM.
--
-- The firm's own people log hours against a client. That is internal costing
-- intelligence and NOTHING ELSE: clients are still billed flat amounts per
-- engagement, and a time entry must never reach an invoice. There is no path
-- from this table to payment_requests and there is not meant to be one.
--
-- ── THE ONE RULE THIS SCHEMA EXISTS TO ENFORCE ─────────────────────────────
--
-- Founder's ruling, 2026-08-06: "maybe have a shared capacity view, just the
-- revenue and how the owner has billing rates for his team members should be
-- kept private." And, immediately after: "regardless it should all be role
-- permission that are set though."
--
-- So the split is HOURS vs MONEY, not entries vs aggregates:
--
--   HOURS  — shared. Everybody in the firm can read how much time went where,
--            because that is a workload board and a firm needs one.
--   MONEY  — gated on a CAPABILITY, not on the owner rank. Cost rates, billable
--            rates, what an hour cost, what a client's margin is.
--
-- ── WHY THE GATE IS A CAPABILITY AND NOT current_user_is_owner() ───────────
--
-- The founder's second sentence is the whole design here. An owner-rank check
-- would mean the only way to let a senior manager see the firm's numbers is to
-- make them an owner, which hands over every other key in the building at the
-- same time.
--
-- The capability model (1120 per-person grants, 1260 roles) already stores
-- exactly this, IN THE DATABASE — so RLS can ask the same question the UI asks
-- instead of a coarser one. That matters more than it looks: grantable.ts
-- refuses to hand out clients.private precisely BECAUSE that capability is
-- decided by RLS and granting it "would change what the UI renders and nothing
-- about what the database returns. A switch that does not work is worse than no
-- switch." A rates switch gated by an owner-rank policy would be exactly that
-- broken switch. So the policy reads the capability.
--
-- ── WHY RATES ARE THEIR OWN TABLE INSTEAD OF COLUMNS ON users ─────────────
--
-- The obvious shape is users.cost_rate_hourly, and it does not hold. The
-- roster's policy (users_select, 0002 as narrowed by 1300) lets every member
-- SELECT the whole row of every teammate. RLS is ROW-level: it cannot hide one
-- column from one person. So a rate column on users is readable by any staff
-- member who asks PostgREST for it directly, no matter what the app strips on
-- the way out — and "strip it at the API layer" only protects you when the API
-- is the only door. It isn't.
--
-- A separate table can be owner-only, and it is. Staff selecting user_rates get
-- zero rows: not a filtered answer, nothing at all.
--
-- The same argument, a second time, is why cost_rate_snapshot is NOT a column
-- on time_entries. Staff must read their own entries (and everybody's hours, per
-- the ruling above), and a column on a row they can read is a column they can
-- read. It lives in time_entry_costs, owner-only, keyed 1:1.
--
-- ── WHY THE SNAPSHOT EXISTS AT ALL ─────────────────────────────────────────
--
-- Profitability math reads the rate that was true WHEN THE HOUR WAS WORKED, not
-- the rate that is true today. Without the snapshot, giving somebody a raise
-- silently rewrites every margin the firm has ever looked at, including the ones
-- it made decisions on. Same reasoning as engagement_items copying a service's
-- price instead of reading through to it (1480): a stored agreement must not
-- shift under a later edit.
--
-- ── APPLY-TIME NOTE ────────────────────────────────────────────────────────
--
-- Purely additive: four new objects and one new firms column, nothing existing
-- is altered. The feature is behind firms.time_insights_enabled, which defaults
-- FALSE — so applying this migration changes nothing anybody can see until the
-- flag is turned on for a firm.

-- ── THE FEATURE FLAG ───────────────────────────────────────────────────────
-- Same shape and same polarity as workflows_enabled / ai_suggestions_enabled
-- (1560): defaults OFF, and a missing column, a read error or an absent row all
-- read as off. Only an explicit true turns anything on.
alter table public.firms
  add column if not exists time_insights_enabled boolean not null default false;

comment on column public.firms.time_insights_enabled is
  'Feature flag for time tracking + the Insights section. Defaults false; a '
  'missing/errored read must be treated as false by the app.';

-- ── THE CAPABILITY GATE ────────────────────────────────────────────────────
-- Asks in SQL the same question src/lib/auth/capabilities.ts asks in TypeScript,
-- against the same stored data: the owner rank, users.extra_capabilities (1120)
-- and every role the person wears (firm_roles.capabilities, 1260).
--
-- Security-definer for the same reason as current_user_is_owner (0190): it must
-- read users/firm_roles without tripping their own RLS. Self-scoping keeps it
-- safe to leave public — it only ever answers about auth.uid(), so there is no
-- way to ask it about somebody else.
--
-- ⚠️ IT DELIBERATELY DOES NOT MODEL THE STAFF FLOOR. capabilitiesFor() starts
-- every non-owner with money.view + clients.manage; this function does not,
-- because no floor capability gates a table and pretending otherwise would make
-- the two implementations disagree the moment one is used for something new.
-- Only pass capabilities that are meant to be additive-only.
create or replace function public.current_user_has_capability(cap text)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role = 'owner'
        or cap = any (coalesce(u.extra_capabilities, '{}'))
        or exists (
          select 1
          from public.user_firm_roles ufr
          join public.firm_roles fr on fr.id = ufr.role_id
          where ufr.user_id = u.id
            and cap = any (coalesce(fr.capabilities, '{}'))
        )
      )
  )
$$;

comment on function public.current_user_has_capability(text) is
  'True if the CALLER holds the given capability — by being an owner, by a '
  'per-person grant (users.extra_capabilities, 1120), or through a role '
  '(firm_roles.capabilities, 1260). Mirrors capabilitiesFor() in '
  'src/lib/auth/capabilities.ts, minus the staff floor. Self-scoping: it can '
  'only ever answer about auth.uid().';

-- ── RATES — OWNER-ONLY ─────────────────────────────────────────────────────
-- One row per person, created on first edit rather than for every user, so an
-- empty table means "nobody has a rate set" and the absence of a row is a real
-- and readable state (their hours are excluded from cost estimates, and the
-- Insights banner says so by name).
create table if not exists public.user_rates (
  user_id uuid primary key references public.users(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- What this person COSTS the firm per hour, CAD. This is the only rate any
  -- v1 math reads.
  cost_rate_hourly numeric(10, 2)
    check (cost_rate_hourly is null or cost_rate_hourly >= 0),
  -- What the firm would CHARGE for their hour, CAD. Stored now, deliberately
  -- unread: Vylan bills flat amounts, so multiplying this into anything would
  -- be inventing hourly billing. It exists so a future feature does not need a
  -- migration and a backfill.
  billable_rate_hourly numeric(10, 2)
    check (billable_rate_hourly is null or billable_rate_hourly >= 0),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.users(id) on delete set null
);

create index if not exists user_rates_firm_idx on public.user_rates (firm_id);

comment on table public.user_rates is
  'Per-person hourly rates, CAD. OWNER-ONLY by RLS — deliberately not columns '
  'on users, because RLS cannot hide a column and every member can read the '
  'whole roster row.';

alter table public.user_rates enable row level security;

-- Gated on rates.manage — held by every owner automatically, and grantable to
-- anybody else through a role or a per-person switch. Nobody else reads a row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_rates'
      and policyname = 'user_rates_select'
  ) then
    create policy user_rates_select on public.user_rates
      for select using (
        firm_id = public.current_firm_id()
        and public.current_user_has_capability('rates.manage')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_rates'
      and policyname = 'user_rates_write'
  ) then
    create policy user_rates_write on public.user_rates
      for all using (
        firm_id = public.current_firm_id()
        and public.current_user_has_capability('rates.manage')
      ) with check (
        firm_id = public.current_firm_id()
        and public.current_user_has_capability('rates.manage')
      );
  end if;
end $$;

-- ── TIME ENTRIES — HOURS, SHARED ───────────────────────────────────────────
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- Whose hour it is. NOT NULL: an entry with no author cannot be costed, cannot
  -- be edited by the right person, and cannot appear on a capacity board.
  user_id uuid not null references public.users(id) on delete cascade,
  -- A client is REQUIRED and a job is OPTIONAL, exactly as engagement_tasks
  -- decided in 1350 for the same reason: "a client gets a CRA notice and
  -- somebody has to phone about it" is real work that belongs to that client
  -- and to no engagement. Copying that shape rather than inventing a second one
  -- also means the two lists answer "whose work is this" identically.
  client_id uuid not null references public.clients(id) on delete cascade,
  engagement_id uuid references public.engagements(id) on delete set null,
  task_id uuid references public.engagement_tasks(id) on delete set null,
  started_at timestamptz not null,
  -- NULL while a timer is RUNNING. This column is the running state — there is
  -- no separate "active timer" table and no client-side-only timer, so a
  -- refresh, a second device or a crashed tab all recover the same way: the
  -- entry is still there with no end on it.
  ended_at timestamptz,
  -- Computed on stop for a timer, entered directly for a manual entry. Stored
  -- rather than derived from the timestamps because a manual "1.5h yesterday"
  -- has no meaningful start/end pair to subtract, and every reader wants one
  -- number.
  duration_minutes integer not null default 0
    check (duration_minutes >= 0),
  -- Short free text the firm writes to itself ("T2 review call"). Never shown
  -- to a client, so no _fr twin — same call engagement_tasks.notes made.
  note text,
  is_manual boolean not null default false,
  -- Soft delete, the 0139 lifecycle pattern used across the app.
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The two cuts every reader takes: one client's time (the client profile, the
-- engagement list, the per-client cost roll-up) and one person's time (the
-- capacity board, "my time this week").
create index if not exists time_entries_firm_client_started_idx
  on public.time_entries (firm_id, client_id, started_at desc)
  where deleted_at is null;
create index if not exists time_entries_firm_user_started_idx
  on public.time_entries (firm_id, user_id, started_at desc)
  where deleted_at is null;
create index if not exists time_entries_engagement_idx
  on public.time_entries (engagement_id)
  where deleted_at is null;
create index if not exists time_entries_task_idx
  on public.time_entries (task_id)
  where deleted_at is null;

-- ONE RUNNING TIMER PER PERSON, enforced by the DATABASE rather than by the
-- action that starts one. The app also auto-stops the previous timer, but a
-- double-clicked button, two tabs or two devices race that check; a partial
-- unique index cannot be raced. Same principle as every other idempotency key
-- in this schema (the billing period in engagement_billing_charges, 1710).
create unique index if not exists time_entries_one_running_per_user_idx
  on public.time_entries (user_id)
  where ended_at is null and deleted_at is null;

comment on table public.time_entries is
  'Internal time tracking. NEVER billed — clients are invoiced flat amounts per '
  'engagement and nothing here reaches payment_requests. Hours are readable by '
  'the whole firm (the capacity board); the COST of an hour lives in '
  'time_entry_costs, owner-only.';

alter table public.time_entries enable row level security;

-- SELECT is FIRM-WIDE, minus private clients for non-owners.
--
-- This is wider than "your own entries" on purpose, and the founder's ruling is
-- why: a shared capacity view has to be able to add up everybody's hours. It is
-- also what the engagement's own Time list needs — the people doing a job
-- together can see how long it is taking, which is shared work context rather
-- than surveillance.
--
-- client_is_private() is the security-definer helper from 0810; the arm reads
-- exactly like every other client-scoped table's.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_entries'
      and policyname = 'time_entries_select'
  ) then
    create policy time_entries_select on public.time_entries
      for select using (
        firm_id = public.current_firm_id()
        and (
          public.current_user_is_owner()
          or not public.client_is_private(client_id)
        )
      );
  end if;

  -- You log YOUR OWN time. Writing an hour onto a colleague's name is not a
  -- thing the product does, and an owner correcting somebody's entry goes
  -- through the update policy below, not through inserting as them.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_entries'
      and policyname = 'time_entries_insert'
  ) then
    create policy time_entries_insert on public.time_entries
      for insert with check (
        firm_id = public.current_firm_id()
        and user_id = auth.uid()
        and (
          public.current_user_is_owner()
          or not public.client_is_private(client_id)
        )
      );
  end if;

  -- Edit and delete: your own, or anybody's if you are the owner. Separate
  -- policies per command so widening one never silently widens another.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_entries'
      and policyname = 'time_entries_update'
  ) then
    create policy time_entries_update on public.time_entries
      for update using (
        firm_id = public.current_firm_id()
        and (user_id = auth.uid() or public.current_user_is_owner())
      ) with check (
        firm_id = public.current_firm_id()
        and (user_id = auth.uid() or public.current_user_is_owner())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_entries'
      and policyname = 'time_entries_delete'
  ) then
    create policy time_entries_delete on public.time_entries
      for delete using (
        firm_id = public.current_firm_id()
        and (user_id = auth.uid() or public.current_user_is_owner())
      );
  end if;
end $$;

-- ── WHAT AN HOUR COST — OWNER-ONLY ─────────────────────────────────────────
-- 1:1 with time_entries, split off for the single reason given at the top: a
-- column on a row staff can read is a column staff can read.
--
-- A row is written only when the person HAD a rate at the time. No row means
-- "not costable", which is exactly the state the Insights missing-rate banner
-- reports, and it means the cost side can never silently treat an unknown rate
-- as zero — a $0 cost would print an infinite margin and look like good news.
create table if not exists public.time_entry_costs (
  time_entry_id uuid primary key
    references public.time_entries(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- The person's cost_rate_hourly AS IT WAS when the entry was created. Never
  -- updated afterwards, including when the rate changes.
  cost_rate_snapshot numeric(10, 2) not null
    check (cost_rate_snapshot >= 0),
  created_at timestamptz not null default now()
);

create index if not exists time_entry_costs_firm_idx
  on public.time_entry_costs (firm_id);

comment on table public.time_entry_costs is
  'The cost rate captured at the moment a time entry was created. OWNER-ONLY. '
  'Frozen on purpose so a raise does not rewrite historical margins. Absent row '
  '= the person had no rate; that time is excluded from cost estimates rather '
  'than counted as free.';

alter table public.time_entry_costs enable row level security;

-- Readable by insights.view (the money picture) OR rates.manage (the rates
-- themselves), because both are legitimately asking about the cost of an hour.
--
-- ⚠️ STATED PLAINLY RATHER THAN GLOSSED: this row plus its entry's user_id IS
-- that person's hourly rate. Anyone holding insights.view can therefore derive
-- what a colleague costs, even without rates.manage. That is a property of the
-- data, not a leak that better policy text could close — margin is rate times
-- hours, so a capability that shows margin cannot hide rate from somebody
-- determined to divide. Grant insights.view accordingly, and say so on the
-- switch rather than implying a separation that does not exist.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_entry_costs'
      and policyname = 'time_entry_costs_select'
  ) then
    create policy time_entry_costs_select on public.time_entry_costs
      for select using (
        firm_id = public.current_firm_id()
        and (
          public.current_user_has_capability('insights.view')
          or public.current_user_has_capability('rates.manage')
        )
      );
  end if;

  -- WRITES are narrower than reads: rates.manage only. A snapshot is written at
  -- entry-creation time by the SERVICE ROLE (which bypasses RLS), not by the
  -- staff member's own session — the alternative is granting every member
  -- insert on a table whose whole purpose is to be invisible to them.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_entry_costs'
      and policyname = 'time_entry_costs_write'
  ) then
    create policy time_entry_costs_write on public.time_entry_costs
      for all using (
        firm_id = public.current_firm_id()
        and public.current_user_has_capability('rates.manage')
      ) with check (
        firm_id = public.current_firm_id()
        and public.current_user_has_capability('rates.manage')
      );
  end if;
end $$;
