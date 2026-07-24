-- 0860_team_settings.sql
--
-- Team Wave 4 — two more firm-level team settings (owner-configurable), joining
-- clients_private_by_default (0830) in the new Team settings hub.
--
--   notify_on_assignment  — email a teammate when work is assigned/reassigned to
--                           them. Default TRUE (today's behavior).
--   require_review_signoff — require an OWNER to mark an engagement complete
--                           (staff can't self-complete; the owner is the
--                           sign-off). Default FALSE (today's behavior).
--
-- Both are set by owners via the service role (like team_enabled /
-- clients_private_by_default), so no column-level UPDATE grant is needed. The
-- defaults preserve current behavior, so applying this migration changes nothing
-- until an owner flips a switch.

alter table public.firms
  add column if not exists notify_on_assignment boolean not null default true;

alter table public.firms
  add column if not exists require_review_signoff boolean not null default false;

comment on column public.firms.notify_on_assignment is
  'Team setting: when true (default), a teammate is emailed when work is assigned/reassigned to them. Owner-set in Team settings.';
comment on column public.firms.require_review_signoff is
  'Team setting: when true, only an OWNER can mark an engagement complete (staff must hand off for an owner''s sign-off). Default false. Owner-set in Team settings.';
