-- Priced service lines on an engagement.
--
-- WHAT THIS CHANGES CONCEPTUALLY. Until now a Vylan engagement WAS its document
-- checklist (request_items) with a single flat price on the parent row
-- (engagements.invoice_amount_cents, migration 0590). The founder's framing,
-- comparing against Canopy: "an engagement is not purely defined by document
-- requested checklist items. Its abundant amount of tasks and things to do."
--
-- So an engagement becomes a PRICED AGREEMENT that carries work, and that also
-- asks the client for documents — rather than being the document request. These
-- rows are the spine: the invoice is generated from them, and tasks will hang
-- off them (Canopy maps every task to an engagement item).
--
-- request_items is untouched and stays exactly what it is. It answers "what do
-- I need FROM the client"; this answers "what am I DOING for them, and for how
-- much". Two different questions that were previously conflated because only
-- one of them had a table.
--
-- MONEY IS INTEGER CENTS, never a float, matching payment_requests and
-- engagements.invoice_amount_cents. A rate stored as 1250.00 in a numeric column
-- is a rounding bug waiting for a quarterly total.

create table if not exists public.engagement_items (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null
    references public.engagements(id) on delete cascade,
  -- Denormalised so RLS can check the firm without joining engagements on every
  -- row read, the same shape engagement_tasks (1340) uses.
  firm_id uuid not null references public.firms(id) on delete cascade,

  -- What the client sees on the proposal, e.g. "Monthly Bookkeeping & Bank
  -- Reconciliations".
  name text not null,
  description text,

  -- Rate in CENTS. Null = "we will tell you later" — Canopy shows exactly this
  -- as "hourly billing determined later", and a null must never be coerced to 0
  -- or the proposal quietly claims the work is free.
  rate_cents integer,
  -- How the rate is read. 'item' = this much, once per billing period.
  -- 'hour' = this much per hour, so the period total is unknowable up front.
  rate_type text not null default 'item'
    check (rate_type in ('item', 'hour')),
  -- How often it is billed. 'once' is the default because a one-off job is the
  -- common case for a tax return, which is most of what this firm does.
  billing_frequency text not null default 'once'
    check (billing_frequency in ('once', 'weekly', 'monthly', 'quarterly', 'yearly')),
  -- Percentage, not cents. Nullable = "use the firm's default", which is a
  -- different statement from 0 (explicitly untaxed).
  tax_pct numeric(5,2),

  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists engagement_items_engagement_idx
  on public.engagement_items (engagement_id, order_index);
create index if not exists engagement_items_firm_idx
  on public.engagement_items (firm_id);

alter table public.engagement_items enable row level security;

-- Same shape as every other firm-scoped table: you see your firm's rows.
-- Written as separate policies per command rather than one `for all`, so a
-- later change to who may DELETE does not silently widen SELECT too.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'engagement_items'
      and policyname = 'engagement_items_select'
  ) then
    create policy engagement_items_select on public.engagement_items
      for select using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'engagement_items'
      and policyname = 'engagement_items_write'
  ) then
    create policy engagement_items_write on public.engagement_items
      for insert with check (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'engagement_items'
      and policyname = 'engagement_items_update'
  ) then
    create policy engagement_items_update on public.engagement_items
      for update using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'engagement_items'
      and policyname = 'engagement_items_delete'
  ) then
    create policy engagement_items_delete on public.engagement_items
      for delete using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;
end $$;

comment on table public.engagement_items is
  'Priced service lines on an engagement — the scope. The invoice is generated from these, and tasks hang off them. Distinct from request_items, which is what the firm needs FROM the client.';
comment on column public.engagement_items.rate_cents is
  'Integer cents. NULL means the rate is not fixed yet (hourly, determined later) — never coerce to 0, or the proposal claims the work is free.';
