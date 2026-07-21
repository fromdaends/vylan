-- Recurring engagements (Phase 1): the series definition + the occurrence
-- ledger, plus the linkage columns on engagements.
--
-- Model:
--   * recurring_series      — the "recipe". One row per repeating engagement:
--                             client, base title, frequency, anchor day,
--                             due-date offset, and a JSONB SNAPSHOT of the
--                             checklist (same TemplateItem shape templates
--                             use). Editing a series edits ONLY this row —
--                             existing engagements are separate copies, so
--                             edit-future semantics are structural, not
--                             enforced by convention.
--   * recurring_occurrences — the idempotency ledger. One row per
--                             (series, period_key), e.g. ('…', '2027-03').
--                             UNIQUE(series_id, period_key) is THE
--                             no-duplicate-spawn guarantee: whatever the job
--                             runner does (retries, overlaps, manual "spawn
--                             now" racing the cron), a second insert for the
--                             same period fails at the database. engagement_id
--                             is ON DELETE SET NULL so purging an occurrence
--                             never frees its period to be spawned again.
--
-- Trust model:
--   * Accountants read/write series through the RLS-scoped session client.
--   * The spawner (Phase 2 cron) runs as the service role (bypasses RLS),
--     like every other worker in /api/cron/process-jobs.
--   * anon gets NOTHING.
--
-- GATED: all reads in code degrade gracefully when this migration hasn't been
-- applied yet (missing-schema detection, the repo's 0450+/0650 pattern), so
-- code can deploy ahead of the SQL.
--
-- Additive + reversible (down: drop the two engagements columns, then
-- recurring_occurrences, then recurring_series).

create table if not exists recurring_series (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- The engagement the series was created from. Reference only — deleting it
  -- must never kill the series (SET NULL).
  source_engagement_id uuid references engagements(id) on delete set null,
  -- Base title; occurrences are named "<title> - <period>" at spawn time.
  title text not null check (char_length(title) between 2 and 160),
  type text not null check (type in ('t1', 't2', 'bookkeeping', 'custom')),
  frequency text not null
    check (frequency in ('monthly', 'quarterly', 'yearly')),
  -- Day-of-month each occurrence spawns on, captured when repeat is enabled
  -- and clamped to short months at spawn time (a 31 series lands on Feb 28).
  anchor_day int not null check (anchor_day between 1 and 31),
  -- Every spawned engagement is due this many days after it spawns.
  due_offset_days int not null default 15
    check (due_offset_days between 1 and 365),
  -- Checklist snapshot (TemplateItem[]), copied into request_items at spawn —
  -- identical to how templates store their items.
  items jsonb not null default '[]'::jsonb,
  -- Per-spawn engagement settings carried onto each occurrence.
  ai_enabled boolean not null default true,
  reminder_settings jsonb,
  -- Invoice recurrence (wired in Phase 4; columns exist now so Phase 4 needs
  -- no second migration). When true, each spawned engagement gets a fresh
  -- invoice built from invoice_snapshot (amount/settings incl. the lock).
  invoice_recreate boolean not null default false,
  invoice_snapshot jsonb,
  status text not null default 'active'
    check (status in ('active', 'paused', 'ended')),
  -- The next date (firm-local calendar date) a spawn is due. The hourly
  -- spawner claims series where next_spawn_on <= the firm's local today,
  -- spawns ONE occurrence, and jumps this forward one cycle — never looping
  -- to backfill, so downtime can't cause a spawn storm.
  next_spawn_on date not null,
  paused_at timestamptz,
  ended_at timestamptz,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists recurring_series_firm_idx
  on recurring_series (firm_id);
-- The spawner's scan: active series that are due.
create index if not exists recurring_series_due_idx
  on recurring_series (status, next_spawn_on);

create table if not exists recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references recurring_series(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  -- 'YYYY-MM' (monthly), 'YYYY-Qn' (quarterly), 'YYYY' (yearly).
  period_key text not null check (char_length(period_key) between 4 and 12),
  -- SET NULL, not cascade: the ledger row must outlive the engagement so a
  -- deleted/purged occurrence can never be re-spawned.
  engagement_id uuid references engagements(id) on delete set null,
  created_at timestamptz not null default now(),
  -- THE idempotency guarantee. See header comment.
  unique (series_id, period_key)
);

create index if not exists recurring_occurrences_firm_idx
  on recurring_occurrences (firm_id);
create index if not exists recurring_occurrences_engagement_idx
  on recurring_occurrences (engagement_id);

-- Linkage on engagements: which series (and which period) an engagement was
-- spawned for. Powers the "Recurring" badge + series panel without a join
-- table scan. SET NULL so ending/deleting a series never touches engagements.
alter table engagements
  add column if not exists series_id uuid
    references recurring_series(id) on delete set null;
alter table engagements
  add column if not exists series_period text;
create index if not exists engagements_series_idx
  on engagements (series_id) where series_id is not null;

-- RLS + grants, following the repo's table-grant hardening pattern (0190 /
-- 0390 / 0650): revoke default PostgREST grants, re-grant only what the app
-- needs to `authenticated` (anon gets NOTHING), firm-scope every path.

alter table recurring_series enable row level security;

drop policy if exists recurring_series_select on recurring_series;
create policy recurring_series_select on recurring_series
  for select using (firm_id = public.current_firm_id());

-- Same containment rule as 0650: the client (and source engagement, when set)
-- must belong to the caller's firm too, so a member of firm A can never point
-- a series at firm B's client.
drop policy if exists recurring_series_insert on recurring_series;
create policy recurring_series_insert on recurring_series
  for insert with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from clients c
      where c.id = client_id
        and c.firm_id = public.current_firm_id()
    )
    and (
      source_engagement_id is null
      or exists (
        select 1 from engagements e
        where e.id = source_engagement_id
          and e.firm_id = public.current_firm_id()
      )
    )
  );

drop policy if exists recurring_series_update on recurring_series;
create policy recurring_series_update on recurring_series
  for update using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

-- No DELETE grant: ending a series is a status change, and the ledger must
-- survive. (The service role can still clean up if ever needed.)
revoke all on recurring_series from anon, authenticated;
grant select, insert, update on recurring_series to authenticated;

alter table recurring_occurrences enable row level security;

drop policy if exists recurring_occurrences_select on recurring_occurrences;
create policy recurring_occurrences_select on recurring_occurrences
  for select using (firm_id = public.current_firm_id());

-- Accountant-driven inserts happen only when enabling repeat on an engagement
-- (ledger the current period so it can never re-spawn). Series containment
-- mirrors the series insert policy. Spawner inserts use the service role.
drop policy if exists recurring_occurrences_insert on recurring_occurrences;
create policy recurring_occurrences_insert on recurring_occurrences
  for insert with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from recurring_series s
      where s.id = series_id
        and s.firm_id = public.current_firm_id()
    )
  );

-- No UPDATE/DELETE for authenticated: the ledger is append-only from the
-- app's perspective — that is what makes it a guarantee.
revoke all on recurring_occurrences from anon, authenticated;
grant select, insert on recurring_occurrences to authenticated;
