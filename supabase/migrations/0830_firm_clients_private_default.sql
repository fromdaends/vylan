-- 0830_firm_clients_private_default.sql
--
-- Team Wave 4 — firm-level "clients private by default" switch.
--
-- When ON for a firm, newly created clients start "Private to me" (owner-only),
-- and turning it on also backfills that firm's existing clients to private. The
-- flag + the backfill are applied PER FIRM from the owner-gated firm-settings
-- action (via the service-role client, scoped to the owner's firm), NOT here —
-- so other tenants are never touched. The column simply defaults to false, which
-- preserves today's behavior for every existing and future firm until an owner
-- opts in.
--
-- Updated via the service role (like team_enabled in actions/team.ts), so no
-- column-level UPDATE grant to `authenticated` is needed.

alter table public.firms
  add column if not exists clients_private_by_default boolean not null default false;

comment on column public.firms.clients_private_by_default is
  'When true, new clients in this firm default to is_private=true (owner-only), and enabling it backfills existing clients to private. Owner-set from the Team > Firm settings section. Per-firm; default false leaves other tenants unaffected.';
