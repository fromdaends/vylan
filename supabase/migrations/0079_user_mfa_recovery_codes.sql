-- Phase 6 MFA: recovery codes table.
--
-- Supabase MFA enrolls a TOTP factor that the user verifies with their
-- authenticator app. If they lose access to that device (lost phone,
-- wiped 1Password vault), they're locked out — there's no built-in
-- recovery path. This table holds 8 single-use recovery codes per user
-- that can be redeemed in lieu of a TOTP code.
--
-- Redeeming a recovery code TEARS DOWN MFA for the user (the server
-- action calls supabase.auth.mfa.unenroll for each factor and deletes
-- this user's remaining recovery codes). The user is then signed in
-- without MFA and can re-enroll with a new device from /profile.
--
-- Code format on the wire: `xxxx-xxxx-xxxx` (12 hex chars). What lands
-- here is a SHA-256 hash of `${user_id}:${code}` — using the user_id as
-- a salt prevents rainbow-table sharing across users.

create table if not exists user_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tight partial index on "still-redeemable codes for this user" — the
-- hot path during login MFA challenge.
create index if not exists user_mfa_recovery_codes_user_unused_idx
  on user_mfa_recovery_codes(user_id)
  where used_at is null;

alter table user_mfa_recovery_codes enable row level security;

-- A user can read their own recovery-code rows (the timestamps are
-- useful for showing "7 of 8 codes remaining" in the UI later). The
-- code_hash column being readable is fine — it's a hash.
create policy user_mfa_recovery_codes_select_self
  on user_mfa_recovery_codes
  for select to authenticated
  using (user_id = auth.uid());

-- The server-side redemption path goes through the service-role client,
-- so we do NOT grant insert / update / delete to authenticated. That
-- keeps the table append-only from the user's perspective and forces
-- mutation through the rate-limited server action.
