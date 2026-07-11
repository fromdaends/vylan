-- Solo firms are not teams by default.
--
-- 0530 preserved the old UI for every existing firm by defaulting team mode
-- to true. That incorrectly left assignment controls visible for firms with
-- only their owner. A real team is an explicit mode: existing multi-member
-- firms (or firms with a live invitation) keep it enabled, while solo firms
-- start with it disabled and can opt in from Settings > Team.

alter table firms
  alter column team_enabled set default false;

update firms f
set team_enabled =
  exists (
    select 1
    from users u
    where u.firm_id = f.id
      and u.deactivated_at is null
    group by u.firm_id
    having count(*) > 1
  )
  or exists (
    select 1
    from firm_invites i
    where i.firm_id = f.id
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  );

comment on column firms.team_enabled is
  'Whether collaboration UI is enabled. Defaults off for solo firms; enabled explicitly by Create team or inferred for existing multi-member firms.';
