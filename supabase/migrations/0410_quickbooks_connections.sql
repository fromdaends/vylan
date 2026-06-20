-- QuickBooks (Intuit) connection — Stage 1: CONNECTION ONLY.
--
-- Stores ONE QuickBooks Online OAuth connection per firm so an accountant can
-- link their Intuit company to Vylan. This stage does NOT read financial data,
-- write transactions, or touch documents — it only holds the connection
-- (access + refresh tokens, the Intuit company/"realm" id, expiries, and the
-- friendly company name) and which environment it was made in (sandbox today,
-- production once Intuit approves the app — a single env switch, no code change).
--
-- SECURITY (mirrors the Stripe Connect posture in 0370 + the column whitelist in
-- 0039):
--   * RLS is ON and firm-scoped: a firm can only ever see its OWN connection row,
--     so one firm can never read another firm's QuickBooks connection.
--   * The two real secrets — access_token + refresh_token — are NOT readable by
--     authenticated users at all (column-level REVOKE). Only the service role
--     (server-side OAuth callback / token refresh / disconnect) reads them. The
--     harmless display fields (realm id, company name, environment, dates) stay
--     readable so the Settings page can render the "Connected" state.
--   * All writes (insert/update/delete) are service-role-only: an authenticated
--     user can never forge, alter, or attach a connection from the browser.
--
-- Additive + reversible (down: drop table quickbooks_connections).

create table if not exists quickbooks_connections (
  id uuid primary key default gen_random_uuid(),
  -- One connection per firm (a re-connect updates this row in place).
  firm_id uuid not null unique references firms(id) on delete cascade,
  -- Intuit's company id (they call it the "realm id"), returned on the OAuth
  -- callback. Identifies WHICH QuickBooks company is connected.
  realm_id text not null,
  -- The OAuth tokens. SECRETS — service-role-read-only (REVOKE below). The
  -- access token is short-lived (~1h); the refresh token is long-lived (~100d)
  -- and rotates, so we always persist whatever Intuit returns on refresh.
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  -- Friendly company display name (one identity-only CompanyInfo read at connect
  -- time) so the connected card reads "Connected to QuickBooks, [Company]".
  company_name text,
  -- Which Intuit environment this connection was made in. Recorded per row so the
  -- mode is known even if the global QBO_ENVIRONMENT switch later flips.
  environment text not null default 'sandbox'
    check (environment in ('sandbox', 'production')),
  -- Who connected it (firm owner). FK clears if the user is later removed.
  connected_by uuid references users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One Intuit company maps to exactly one firm (forge-proof, mirrors the Stripe
-- connected-account unique index in 0370). firm_id is already UNIQUE above.
create unique index if not exists quickbooks_connections_realm_idx
  on quickbooks_connections (realm_id);

alter table quickbooks_connections enable row level security;

-- Firm members may READ their own firm's connection (drives the Settings UI).
-- No insert/update/delete policy: those are service-role-only (the service role
-- bypasses RLS). SELECT-only at the policy layer.
drop policy if exists quickbooks_connections_select on quickbooks_connections;
create policy quickbooks_connections_select on quickbooks_connections for select
  using (firm_id = public.current_firm_id());

-- Defense in depth on top of RLS:
--   1. No browser-side writes at all — service role only.
revoke insert, update, delete on quickbooks_connections from authenticated, anon;
--   2. The token columns are never selectable by authenticated/anon, so a curious
--      or compromised user can never exfiltrate the OAuth secrets via PostgREST.
--      Display columns stay selectable (gated to the firm by the policy above).
revoke select (access_token, refresh_token)
  on quickbooks_connections from authenticated, anon;
