-- QuickBooks (Intuit) connection — Stage 1: CONNECTION ONLY.
--
-- Stores ONE QuickBooks Online OAuth connection per firm so an accountant can
-- link their Intuit company to Vylan. This stage does NOT read financial data,
-- write transactions, or touch documents — it only holds the connection
-- (access + refresh tokens, the Intuit company/"realm" id, expiries, and the
-- friendly company name) and which environment it was made in (sandbox today,
-- production once Intuit approves the app — a single env switch, no code change).
--
-- SECURITY (uses the table-revoke + column-grant whitelist pattern from 0039 /
-- 0190 / 0230 — NOT 0370, which deliberately keeps SELECT table-wide because the
-- firms columns hold no secrets):
--   * RLS is ON and firm-scoped: a firm can only ever see its OWN connection row,
--     so one firm can never read another firm's QuickBooks connection.
--   * The two real secrets — access_token + refresh_token — are NOT readable by
--     authenticated users at all: we revoke the default table-level grant and
--     re-grant SELECT on the display columns ONLY (the tokens are omitted), so the
--     token columns are unreadable via PostgREST. Only the service role (the
--     server-side OAuth callback / token refresh / disconnect) reads them. The
--     display fields (realm id, company name, environment, dates) stay readable so
--     the Settings page can render the "Connected" state.
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

-- Lock down the table-level grants PostgREST gives every new public table by
-- default. A column-level `revoke select (...)` is a NO-OP while a table-level
-- SELECT grant still exists — Postgres consults column privileges only when there
-- is no covering table grant. So we must REVOKE the table-level grant first, then
-- GRANT SELECT on the non-secret display columns ONLY. Same pattern as 0039
-- (column-update whitelist) and 0190 / 0230 (table-grant lockdown).
--
--   * No browser-side writes at all — service role only (no insert/update/delete
--     grant).
--   * access_token + refresh_token are deliberately OMITTED from the SELECT
--     grant, so they are genuinely unreadable by authenticated/anon via PostgREST
--     (a `select access_token ...` returns "permission denied for column"). Only
--     the service role — which bypasses these grants — reads the tokens.
--   * The firm-scoped RLS policy above still gates WHICH rows are visible, so one
--     firm can never see another firm's connection.
revoke all on quickbooks_connections from anon, authenticated;
grant select (
  id,
  firm_id,
  realm_id,
  company_name,
  environment,
  connected_by,
  connected_at,
  updated_at,
  access_token_expires_at,
  refresh_token_expires_at
) on quickbooks_connections to authenticated;
