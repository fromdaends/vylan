-- Team / multi-user — Phase 1 data model.
--
-- Builds on the role model that has existed since 0001 (user_role enum
-- 'owner'|'staff'; users.role default 'staff'; engagements.assigned_user_id).
-- Two roles only — no third role is introduced.
--
--   * firm_invites             — pending teammate invitations (single-use,
--                                7-day, revocable). The raw token is emailed
--                                once and never stored; only its SHA-256 hash
--                                lives here. Owner-only + firm-scoped SELECT;
--                                ALL writes go through the service-role client
--                                in owner-only server actions (Phase 2/3).
--   * firms.seat_cap_override  — manual per-firm seat cap that overrides the
--                                plan default. Service-role-only (see note).
--   * users.deactivated_at /   — soft "remove teammate". Removed members are
--     users.deactivated_by_user_id  deactivated, never hard-deleted, so the
--                                audit trail + historical names survive.
--                                Service-role-only.
--   * engagements.assigned_at  — timestamp companion to the existing
--                                assigned_user_id (who is ACCOUNTABLE for the
--                                engagement). Accountability, NOT access
--                                control — every member still sees every
--                                engagement.
--   * current_user_is_owner()  — security-definer helper for owner-only RLS,
--                                mirroring current_firm_id() / is_firm_member().
--
-- COLUMN-LOCK NOTE (why there is no new firms/users GRANT statement here):
-- 0039 + 0059 locked `users` and `firms` UPDATE to an explicit column whitelist
-- for the `authenticated` role. New columns are NOT in those whitelists, so
-- seat_cap_override, deactivated_at and deactivated_by_user_id are automatically
-- un-writable via PostgREST by any logged-in user — only the service-role key
-- (onboarding / billing / team server actions) can set them. That is exactly the
-- protection the team feature needs, so we deliberately DON'T re-grant those
-- columns. (engagements has no column whitelist, and assigning an engagement is
-- allowed for every firm member, so assigned_at needs no lock.)

------------------------------------------------------------------------------
-- HELPER: is the calling user their firm's owner?
------------------------------------------------------------------------------
-- security definer so it bypasses RLS on `users` (same pattern as
-- current_firm_id / is_firm_member in 0001). Used by the firm_invites SELECT
-- policy below and available to any future owner-only RLS.
create or replace function public.current_user_is_owner() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'owner'
  )
$$;

------------------------------------------------------------------------------
-- TABLE: firm_invites
------------------------------------------------------------------------------
create table if not exists firm_invites (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- citext: email matching is case-insensitive everywhere else in the schema
  -- (users.email, clients.email), so invite lookups + the "already a Vylan
  -- user" guard stay consistent.
  email citext not null,
  role user_role not null default 'staff',
  -- SHA-256 (hex) of the single-use raw token. The raw token is emailed once
  -- and never persisted; we only ever compare hashes on accept.
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references users(id) on delete set null,
  revoked_at timestamptz,
  invited_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists firm_invites_firm_email_idx
  on firm_invites (firm_id, email);
create index if not exists firm_invites_token_hash_idx
  on firm_invites (token_hash);

comment on table firm_invites is
  'Pending teammate invitations. Single-use, 7-day, revocable. Owner-only + firm-scoped SELECT; all writes via the service-role client (createInvite / revokeInvite / resendInvite / acceptInvite server actions). Token stored as SHA-256 hash only.';

-- Lock down. RLS on; revoke the default PostgREST grants; then re-grant SELECT
-- only, so an OWNER can list their own firm's invites with the authed client.
-- INSERT/UPDATE/DELETE have no grant + no policy => denied for authenticated;
-- the service-role key (which bypasses RLS) is the only write path.
alter table firm_invites enable row level security;
revoke all on firm_invites from anon, authenticated;
grant select on firm_invites to authenticated;

drop policy if exists firm_invites_select_owner on firm_invites;
create policy firm_invites_select_owner on firm_invites for select
  using (
    firm_id = public.current_firm_id()
    and public.current_user_is_owner()
  );

------------------------------------------------------------------------------
-- firms: manual seat-cap override (service-role-only — see column-lock note)
------------------------------------------------------------------------------
alter table firms
  add column if not exists seat_cap_override integer;

alter table firms
  drop constraint if exists firms_seat_cap_override_check;
alter table firms
  add constraint firms_seat_cap_override_check
  check (seat_cap_override is null or seat_cap_override > 0);

comment on column firms.seat_cap_override is
  'Manual per-firm seat cap that overrides the plan default (PLANS[plan].maxUsers). NULL = use the plan default. Service-role-only: intentionally excluded from the authenticated UPDATE column whitelist (0039/0059).';

------------------------------------------------------------------------------
-- users: deactivation (soft "remove teammate"; never hard-deleted)
------------------------------------------------------------------------------
alter table users
  add column if not exists deactivated_at timestamptz;
alter table users
  add column if not exists deactivated_by_user_id uuid references users(id) on delete set null;

comment on column users.deactivated_at is
  'When set, this member was removed from the firm (deactivated, not deleted). Frees a seat; sign-in is rejected (Phase 6). Service-role-only column.';

------------------------------------------------------------------------------
-- engagements: assignment timestamp (assigned_user_id exists since 0001)
------------------------------------------------------------------------------
alter table engagements
  add column if not exists assigned_at timestamptz;

comment on column engagements.assigned_at is
  'When assigned_user_id was last set. Accountability only — engagement visibility stays firm-wide.';

------------------------------------------------------------------------------
-- VERIFICATION (run interactively after applying; cannot run in CI — no test DB)
------------------------------------------------------------------------------
-- 1) Staff cannot see invites: signed in as a role='staff' member,
--      select * from firm_invites;            -> 0 rows
--    signed in as the role='owner',
--      select * from firm_invites;            -> the firm's invites.
-- 2) Authenticated cannot set the seat override: signed in as any member,
--      update firms set seat_cap_override = 99 where id = current_firm_id();
--    -> ERROR: permission denied for column seat_cap_override
--    (the service-role key succeeds; that is the only intended path).
