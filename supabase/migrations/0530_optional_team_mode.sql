-- Optional team mode.
--
-- A firm remains the tenant/workspace boundary even when its owner does not
-- want collaboration features. Turning team mode off is deliberately
-- non-destructive: clients, engagements, historical assignments and audit
-- records stay intact, while the application hides all team/assignment UI.
-- Re-enabling team mode makes those features available again.

alter table firms
  add column if not exists team_enabled boolean not null default true;

comment on column firms.team_enabled is
  'Whether collaboration UI (members, assignments, Mine filters) is enabled. Turning it off preserves all firm data.';

-- The column is intentionally excluded from the authenticated firms UPDATE
-- grant whitelist. createTeam / leaveTeam use the service-role client after an
-- owner check, matching the existing team-management write model.
