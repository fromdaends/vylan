-- Xero connection — Phase 1: CONNECTION ONLY, per client from day one.
--
-- Stores one Xero OAuth connection PER (firm, client) so an accountant links
-- each client's own Xero organisation from that client's page — the same model
-- QuickBooks landed on (0710/0720), minus its legacy firm-level (NULL client)
-- rows: Xero starts per-client, so client_id is NOT NULL and none of the
-- firm-level fallback machinery exists.
--
-- This phase does NOT read financial data or write transactions — it only holds
-- the connection: OAuth tokens (rotating refresh token → fingerprint column for
-- the optimistic-concurrency lock, baked in from day one, mirroring 0480),
-- Xero's tenant (organisation) id + the connection id (needed to disconnect ONE
-- org via DELETE /connections/{id} — Xero-side token revocation would kill ALL
-- of that user's connections, so we never use it for a per-client disconnect),
-- and display fields (org name, country, demo flag).
--
-- SECURITY: same revoke-all + column-grant whitelist pattern as 0410 — RLS is
-- firm-scoped, the token columns are unreadable by authenticated users (service
-- role only), and all writes are service-role-only.
--
-- Additive + reversible (down: drop table xero_connections).

create table if not exists xero_connections (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- Per-client from day one (no firm-level rows, unlike QuickBooks' transition).
  client_id uuid not null references clients(id) on delete cascade,
  -- Xero's organisation id ("tenantId") — identifies WHICH Xero org is
  -- connected. Sent as the Xero-tenant-id header on every API call.
  tenant_id text not null,
  -- Xero's connection id for this app↔org link, captured from GET /connections
  -- at connect time. DELETE /connections/{connection_id} disconnects just this
  -- org. Nullable defensively (a connect that couldn't read it still works;
  -- disconnect then just clears locally).
  connection_id text,
  -- The OAuth tokens. SECRETS — service-role-read-only (REVOKE below). Access
  -- token ~30 min; refresh token ~60 days, single-use ROTATING (we persist
  -- whatever Xero returns on every refresh).
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  -- sha256 hex of the PLAINTEXT refresh token — the optimistic-concurrency
  -- match for rotations (GCM ciphertext is non-deterministic, so the token
  -- column itself can't be compared). Same design as 0480.
  refresh_token_fingerprint text,
  -- Display fields (one Organisation read at connect): org name, ISO country
  -- (e.g. "CA" — drives tax handling later), and whether it's Xero's resettable
  -- Demo Company (the "Demo" badge; Xero has no sandbox/production key split).
  tenant_name text,
  country_code text,
  is_demo boolean not null default false,
  connected_by uuid references users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One connection per (firm, client); a re-connect updates the row in place.
-- Plain unique works — client_id is NOT NULL (no NULLS NOT DISTINCT needed).
create unique index if not exists xero_connections_firm_client_idx
  on xero_connections (firm_id, client_id);

-- One Xero organisation maps to exactly one client row (forge-proof; mirrors
-- quickbooks_connections_realm_idx and the Stripe account index in 0370).
create unique index if not exists xero_connections_tenant_idx
  on xero_connections (tenant_id);

alter table xero_connections enable row level security;

-- Firm members may READ their own firm's connections (drives the client-page
-- card + the Integrations hub badge). Writes are service-role-only (no
-- insert/update/delete policy — the service role bypasses RLS).
drop policy if exists xero_connections_select on xero_connections;
create policy xero_connections_select on xero_connections for select
  using (firm_id = public.current_firm_id());

-- Revoke the default table-level grants, then re-grant SELECT on the non-secret
-- display columns ONLY — the token columns (and the fingerprint) stay unreadable
-- via PostgREST. Same pattern as 0410.
revoke all on xero_connections from anon, authenticated;
grant select (
  id,
  firm_id,
  client_id,
  tenant_id,
  tenant_name,
  country_code,
  is_demo,
  connected_by,
  connected_at,
  updated_at,
  access_token_expires_at,
  refresh_token_expires_at
) on xero_connections to authenticated;
