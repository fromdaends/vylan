-- Public demo qualifying form. Prospects (not customers) fill a
-- 3-step form on /[locale]/demo and we save progressively after each
-- step so a partial fill still captures their email.
--
-- This table is NOT firm-scoped (these are leads, not tenants).
-- Instead we lock it down: only the service-role client writes (via
-- the saveDemoStep server action) and only the founder reads via the
-- Supabase dashboard. RLS is enabled with zero policies for anon /
-- authenticated, which means PostgREST denies both reads and writes
-- from the public API — the service-role key is the only path in.

create table demo_requests (
  id uuid primary key default gen_random_uuid(),

  -- Step 1: who you are. email is the only truly required field at
  -- the DB level so the founder always has a way to follow up if the
  -- prospect drops off after Step 1.
  contact_name text,
  email text not null,
  firm_name text,

  -- Step 2: qualifying (the whole reason this form exists).
  firm_size text,        -- 'solo' | '2_5' | '6_15' | '16_plus'
  client_volume text,    -- 'under_25' | '25_100' | '100_300' | '300_plus'
  current_tool text,     -- 'manual_email' | 'taxdome' | 'karbon' | 'other_software' | 'nothing'
  current_tool_other text,

  -- Step 3: contact + scheduling preferences.
  phone text,
  province text,
  preferred_language text,    -- 'fr' | 'en'
  -- CASL: explicit opt-in, unchecked by default in the form. NEVER
  -- default this to true.
  marketing_opt_in boolean not null default false,

  -- Funnel meta.
  -- How far the prospect got: 1 = filled step 1, 2 = filled step 2,
  -- 3 = filled step 3 (qualified). booked_at is set when the cal.com
  -- embed fires its booking-success event.
  furthest_step integer not null default 1,
  booked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reasonable bounds on furthest_step so a malformed call can't write
-- garbage.
alter table demo_requests
  add constraint demo_requests_furthest_step_check
  check (furthest_step in (1, 2, 3));

-- Indexes:
-- - email so the founder can search a specific prospect quickly.
-- - created_at desc so the inbox view (admin tool, later) sorts the
--   most recent leads first cheaply.
create index demo_requests_email_idx on demo_requests (email);
create index demo_requests_created_at_idx on demo_requests (created_at desc);

-- Keep updated_at fresh on every UPDATE — relied on by progressive
-- save (Step 1 row, then Step 2 + Step 3 updates).
create or replace function demo_requests_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger demo_requests_updated_at
before update on demo_requests
for each row execute function demo_requests_set_updated_at();

-- Lock down. RLS on, zero policies for anon/authenticated. The only
-- code path that touches this table is the saveDemoStep server
-- action, which uses the service-role client.
alter table demo_requests enable row level security;

-- Explicitly revoke any default PostgREST grants so the table is
-- effectively invisible to the anon + authenticated roles. (RLS with
-- no policies already blocks them, but belt-and-suspenders.)
revoke all on demo_requests from anon, authenticated;

comment on table demo_requests is
  'Public-form demo qualifying leads. Service-role writes only via saveDemoStep server action. Prospects, not customers — no firm_id.';
