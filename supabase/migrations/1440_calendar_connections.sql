-- Google Calendar connections — the agenda card's data source.
--
-- ── PER USER, NOT PER FIRM (the one real difference from filing) ────────────
--
-- storage_connections (0900) is per FIRM because client documents file to ONE
-- destination the firm chooses together. A calendar is the opposite: the agenda
-- card says "your day", and two people at the same firm have different days.
-- So the row is keyed by USER, each person connects their own Google account,
-- and nobody can read anybody else's — enforced in RLS below, not in app code.
--
-- firm_id rides along anyway so the row dies with the firm and so a future
-- firm-wide view (a shared "who is in a meeting" board) has the column it would
-- need. It is NOT what grants access.
--
-- ── EVERYTHING ELSE MIRRORS 0900 DELIBERATELY ──────────────────────────────
--
-- Same token columns, same encrypted-at-rest approach (the filing cipher, under
-- STORAGE_TOKEN_ENC_KEY — a third copy of AES-GCM is exactly the drift the
-- cohesion rule exists to stop), same refresh_token_fingerprint trick for
-- optimistic concurrency (GCM ciphertext is random per write and cannot be
-- matched), same status vocabulary, same column-level grant so tokens are
-- unreadable through PostgREST.
--
-- ── SCOPE: READ ONLY, AND ONLY EVENTS ──────────────────────────────────────
--
-- calendar.events.readonly. Vylan shows the day; it never writes to anybody's
-- calendar. If a future feature needs to CREATE events that is a new scope, a
-- new consent, and a deliberate decision — not something this table permits by
-- having stored a token once.
--
-- Idempotent throughout. Safe to run twice.

create table if not exists calendar_connections (
  id uuid primary key default gen_random_uuid(),
  -- WHOSE calendar. The access key for every read below.
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  -- 'active' = usable; 'error' = refresh token dead, needs reconnect;
  -- 'disconnected' = the person turned it off. Only 'active' rows are read.
  status text not null default 'active'
    check (status in ('active', 'error', 'disconnected')),
  -- OAuth tokens. SECRETS — service-role-only via the grant whitelist below,
  -- encrypted at rest by the app (the storage_connections cipher).
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  -- sha256 hex of the PLAINTEXT refresh token — the optimistic-concurrency
  -- match key for rotating refreshes (0900/0480 precedent).
  refresh_token_fingerprint text,
  -- Display only, for the card's footer ("zach@gmail.com").
  account_label text,
  -- Which calendar we read. 'primary' in v1 — a calendar PICKER is a real
  -- feature (people keep a work calendar separate) but it needs somewhere to
  -- choose it, and the agenda card has no settings surface yet.
  calendar_id text not null default 'primary',
  last_synced_at timestamptz,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One ACTIVE calendar per person, as a DB invariant rather than app code, so
-- two racing connects can never both land.
create unique index if not exists calendar_connections_active_one
  on calendar_connections (user_id) where (status = 'active');

create index if not exists calendar_connections_user_idx
  on calendar_connections (user_id, status);

alter table calendar_connections enable row level security;

-- YOUR row and nobody else's. Not "your firm's" — an owner has no business
-- reading a staff member's calendar connection, and the agenda card never asks
-- for one. No insert/update/delete policy: every write is service-role-side
-- (OAuth callback, token refresh, disconnect).
drop policy if exists calendar_connections_select on calendar_connections;
create policy calendar_connections_select on calendar_connections for select
  using (user_id = auth.uid() and firm_id = public.current_firm_id());

-- Token lockdown (0410/0900 pattern): revoke the default grant, then re-grant
-- SELECT on display columns ONLY. access_token / refresh_token /
-- refresh_token_fingerprint are unreadable via PostgREST — "permission denied
-- for column" — and only the service role reads them.
revoke all on calendar_connections from anon, authenticated;
grant select (
  id,
  user_id,
  firm_id,
  provider,
  status,
  account_label,
  calendar_id,
  last_synced_at,
  connected_at,
  disconnected_at,
  updated_at
) on calendar_connections to authenticated;

comment on table calendar_connections is
  'Per-USER Google Calendar OAuth connections powering the Overview agenda card. Read-only scope (calendar.events.readonly). Tokens encrypted at rest and readable only by the service role; RLS scopes every read to the connecting user alone.';

-- Verify after applying:
--
--   select count(*) from calendar_connections;   --> 0
--
--   -- and the lockdown, which is the part worth checking: as an ordinary
--   -- signed-in user, selecting refresh_token must FAIL with
--   -- "permission denied for column refresh_token".
