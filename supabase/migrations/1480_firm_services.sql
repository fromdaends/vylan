-- The firm's SERVICE CATALOGUE — what you sell, defined once.
--
-- The founder's catch, which reordered the whole engagement project:
--
--   "Canopy's service item is a reusable catalogue entry — 'Monthly
--   bookkeeping, $400/mo, creates these 6 tasks' defined once and dropped onto
--   any client. What you have now is the per-engagement copy: you retype the
--   lines each time. The catalogue is what makes 'pick a service, the work
--   appears' possible... It's worth deciding before the tasks step — if tasks
--   get attached to one-off lines, adding a catalogue afterwards means
--   re-pointing all of them."
--
-- Exactly right, which is why this lands BEFORE tasks rather than after.
--
-- WHY NOT firms.service_prices (migration 0380). That is a jsonb map of one
-- price per ENGAGEMENT TYPE — {"t1": 1000, "bookkeeping": 10000} — across four
-- fixed keys. It cannot hold two bookkeeping services at different prices, and
-- carries no frequency, no tax, no description and no tasks. It stays exactly
-- where it is, doing the small job it already does for the invoice presets; this
-- is the thing that was missing, not a replacement for it.
--
-- A service is a TEMPLATE for an engagement item, not a live one. Dropping it
-- onto an engagement COPIES its values into an engagement_items row, which the
-- accountant may then change for that client without touching the catalogue —
-- the founder's call: "picking a service suggests the price, does not lock it".
-- That copy-on-use is also why editing a service later never rewrites history:
-- a proposal a client already agreed to must not change under them.

create table if not exists public.firm_services (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,

  name text not null,
  description text,

  -- Defaults copied onto an engagement item. Same units and meanings as
  -- engagement_items (migration 1450), deliberately: this is that row's
  -- template, so a mismatch here would need a conversion on every use.
  -- NULL rate = "priced per engagement", which is a real service.
  rate_cents integer,
  rate_type text not null default 'item'
    check (rate_type in ('item', 'hour')),
  billing_frequency text not null default 'once'
    check (billing_frequency in ('once', 'weekly', 'monthly', 'quarterly', 'yearly')),
  tax_pct numeric(5,2),

  -- Retired rather than deleted. A service that has been used on engagements is
  -- part of their history; hard-deleting it would leave those rows describing a
  -- service nobody can look up. Archived services stop being offered in pickers.
  archived_at timestamptz,

  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id) on delete set null
);

create index if not exists firm_services_firm_idx
  on public.firm_services (firm_id, order_index);
-- Partial index: pickers only ever ask for the live ones.
create index if not exists firm_services_live_idx
  on public.firm_services (firm_id) where archived_at is null;

alter table public.firm_services enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'firm_services' and policyname = 'firm_services_select'
  ) then
    create policy firm_services_select on public.firm_services
      for select using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'firm_services' and policyname = 'firm_services_insert'
  ) then
    create policy firm_services_insert on public.firm_services
      for insert with check (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'firm_services' and policyname = 'firm_services_update'
  ) then
    create policy firm_services_update on public.firm_services
      for update using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'firm_services' and policyname = 'firm_services_delete'
  ) then
    create policy firm_services_delete on public.firm_services
      for delete using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;
end $$;

-- Which catalogue entry an engagement item came from.
--
-- Nullable and ON DELETE SET NULL: a bespoke line belongs to no service, and a
-- service that is hard-deleted must not take the engagement lines with it — the
-- line keeps its own copied name and price, which is the whole point of copying
-- on use rather than pointing at live values.
alter table if exists public.engagement_items
  add column if not exists service_id uuid
    references public.firm_services(id) on delete set null;

create index if not exists engagement_items_service_idx
  on public.engagement_items (service_id) where service_id is not null;

comment on table public.firm_services is
  'The firm''s service catalogue — what it sells, defined once and dropped onto any engagement. A TEMPLATE for an engagement_items row: using one COPIES its values, so editing a service never rewrites a proposal a client already agreed to.';
comment on column public.engagement_items.service_id is
  'Which catalogue entry this line came from. NULL = a bespoke line. The line keeps its own copied name and price regardless — this records provenance, it does not read through.';
