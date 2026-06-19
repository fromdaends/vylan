-- Payments Phase 3: payment requests + per-service default prices.
--
-- A payment_request is the accountant asking a client to pay for an engagement.
-- The client pays the accountant DIRECTLY via Stripe (Phase 4); this table only
-- tracks the ask and its status. Firm-scoped via RLS. The client portal and the
-- Stripe webhook read/write it through the SERVICE ROLE (which bypasses RLS), so
-- no anon policy is needed.
--
-- Additive + reversible (down: drop the table + the firms.service_prices column).

create table if not exists payment_requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid references engagements(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'cad',
  description text,
  status text not null default 'requested'
    check (status in ('requested', 'paid', 'failed', 'canceled')),
  -- How the accountant chose to deliver the ask. Acted on in Phase 4 (portal
  -- card + emailed pay link); stored here so the choice is recorded at request
  -- time.
  delivery text not null default 'portal'
    check (delivery in ('portal', 'email', 'both')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  requested_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payment_requests_firm_created_idx
  on payment_requests (firm_id, created_at desc);
create index if not exists payment_requests_engagement_idx
  on payment_requests (engagement_id);
create index if not exists payment_requests_payment_intent_idx
  on payment_requests (stripe_payment_intent_id);

alter table payment_requests enable row level security;

-- Firm members read/write their own firm's payment requests (same firm-scoped
-- shape as the other firm tables). The portal + webhook use the service role,
-- which bypasses RLS, so no anon policy is required.
drop policy if exists payment_requests_all on payment_requests;
create policy payment_requests_all on payment_requests for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

-- Per-service default prices (in cents), keyed by engagement type
-- (t1 / t2 / bookkeeping / custom). Lets the accountant set a price once so the
-- Request-payment dialog can pre-fill it. Owner-editable through the Payments
-- settings, so it IS granted (unlike the connect_* columns) on the firms
-- column-level UPDATE whitelist.
alter table firms
  add column if not exists service_prices jsonb not null default '{}'::jsonb;
grant update (service_prices) on public.firms to authenticated;
