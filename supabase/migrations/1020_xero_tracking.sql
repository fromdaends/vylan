-- Xero tracking categories — the last Hubdoc gap.
--
-- A tracking category is a SECOND label on a transaction, alongside the account.
-- The account says what KIND of spend it was (rent, wages, fuel); tracking says
-- which PART of the business it was for. A client with two restaurants keeps one
-- "Food Costs" account and tags each transaction with a location, instead of
-- duplicating every account per site. Xero allows at most TWO active categories
-- per organisation, and each has a list of options.
--
-- ONE TABLE, not two. A category and its options could be normalised apart, but
-- everything we do reads them together (list the options of the categories, put
-- the chosen pair on a line), and the cache is a disposable projection of Xero
-- rather than a source of truth — so a second table would buy referential
-- tidiness we never use and cost a join on every read. Each row is one OPTION,
-- carrying its category's id and name.
--
-- IDS, NOT NAMES, are what get posted. Xero accepts either on a line, but a
-- category or option can be RENAMED in Xero at any time, and a rename between
-- our last sync and the post would fail with an opaque validation error. The
-- GUIDs are stable.
--
-- Same shape as the other 0780 cache tables: per (firm, client), unique on the
-- Xero id, RLS firm-scoped read, service-role writes.
--
-- Additive + reversible (down: drop the table).

create table if not exists xero_tracking_options (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- Xero TrackingOptionID (uuid) — what goes on the posted line.
  xero_id text not null,
  name text not null default '',
  -- The category this option belongs to. Denormalised on purpose (see above).
  category_id text not null,
  category_name text not null default '',
  -- ARCHIVED/DELETED options can't be used on a new line. Tracked at BOTH
  -- levels: archiving the whole category retires every option under it, and
  -- Xero reports those independently.
  active boolean not null default true,
  category_active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, client_id, xero_id)
);

create index if not exists xero_tracking_options_scope_idx
  on xero_tracking_options (firm_id, client_id);

alter table xero_tracking_options enable row level security;

-- Firm members READ their own firm's cache (non-secret reference data, exactly
-- like the accounts/contacts/tax-rates tables). Writes are service-role only —
-- no insert/update/delete policy, and the service role bypasses RLS.
drop policy if exists xero_tracking_options_select on xero_tracking_options;
create policy xero_tracking_options_select on xero_tracking_options for select
  using (firm_id = public.current_firm_id());

revoke all on xero_tracking_options from anon, authenticated;
grant select on xero_tracking_options to authenticated;

-- Verify after applying:
--   select count(*) from xero_tracking_options;
