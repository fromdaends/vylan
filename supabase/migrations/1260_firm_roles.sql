-- Firm roles: a badge the owner defines once and hands out.
--
-- Founder's request, and their own comparison: a Discord server role. A name, a
-- colour, and — like Discord — permissions that can be attached to it, so it
-- has "actual foundation" rather than being a name with text.
--
-- HOW IT MEETS THE EXISTING MEMBER / JUNIOR SWITCH, which is the question the
-- founder asked and did not have an answer to. The preset is the FLOOR: what
-- you get wearing nothing. Roles stack on top, and can only ever ADD. So a
-- Junior who wears a role carrying billing.manage can manage billing, and a
-- Junior who wears nothing still cannot. Nothing a role does can take away what
-- the preset gave. One direction, one answer to "why can she do that".
--
-- WHY THAT SEPARATION MATTERS MORE HERE THAN IT SOUNDS. Vylan already has two
-- things people call a role, and this is a third:
--
--   1. permission presets — Owner / Member / Junior. What you may DO.
--      (users.permission_preset, 1120)
--   2. a client position   — the free-text label under a name on one client's
--      "Who can see this" panel. Per client, descriptive. (client_members
--      .position, 1210)
--   3. a firm role — THIS. Firm-wide, worn everywhere your name appears, and
--      able to carry capabilities of its own.
--
-- #3 grants through the SAME resolver as #1, never beside it: capabilitiesFor()
-- unions preset + per-person grants + role grants and asks one question. Two
-- resolvers is the mess phase 2 spent 98 owner checks escaping.
--
-- COLOUR IS A NAME, NOT A HEX. 'blue', not '#3b82f6' — see src/lib/roles/
-- palette.ts. A stored hex freezes today's palette into every row, so a restyle
-- leaves every existing badge on the old colours. A stored name is a reference
-- and moves with the theme. Unconstrained here rather than a check constraint:
-- the application narrows unknown values to the default, and a constraint would
-- turn "we added a ninth colour" into a failed insert on the older deployment
-- still running during a rollout.
--
-- MANY-TO-MANY. Discord lets one person hold several roles and the founder drew
-- that comparison directly, so the join table is the shape rather than a column
-- on users. It also means removing a role from the firm cannot orphan anybody:
-- the cascade takes the assignments with it.
--
-- Reversible:
--   drop table if exists user_firm_roles;
--   drop table if exists firm_roles;

create table if not exists firm_roles (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  name text not null,
  -- A key from ROLE_COLORS, not a hex. Defaults to the neutral one so a role
  -- created by any path that forgets a colour still renders.
  color text not null default 'slate',
  -- What wearing this role GRANTS. Empty by default: a role is a label until
  -- somebody deliberately attaches something to it.
  --
  -- ADDITIVE ONLY. There is no way to express "this role removes X", and that
  -- is deliberate — a system where roles both grant and revoke gives a firm two
  -- competing answers to "why can she do that", which is the mess the one-place
  -- capability model exists to avoid. The preset (Member / Junior) is the
  -- floor; roles stack on top of it.
  --
  -- Unconstrained text[] rather than an enum: the application narrows to the
  -- vetted grantable list (src/lib/auth/grantable.ts), and a database enum
  -- would turn "we added a capability" into a failed write on whichever
  -- deployment is still running during a rollout.
  capabilities text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- One role of a given name per firm. Case-insensitive: "Manager" and "manager"
-- as two separate badges in the same list is a bug, not a feature.
create unique index if not exists firm_roles_firm_name_idx
  on firm_roles (firm_id, lower(name));

create table if not exists user_firm_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references firm_roles(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (user_id, role_id)
);

-- "Which roles does this person have" — asked for every row of the roster, so
-- it gets an index before it is ever asked at scale.
create index if not exists user_firm_roles_user_idx
  on user_firm_roles (user_id);
create index if not exists user_firm_roles_firm_idx
  on user_firm_roles (firm_id);

alter table firm_roles enable row level security;
alter table user_firm_roles enable row level security;

-- READABLE BY THE WHOLE FIRM, deliberately. A badge nobody but the owner can
-- see is not a badge. No private-client cascade either — unlike client_members
-- (1210), a role says nothing about any client.
--
-- WRITES are gated in the application (team.manage, owner-only) rather than in
-- the policy, matching every other roster write: they all go through the
-- service-role client, so a policy WITH CHECK would be checking a path nobody
-- takes. Authenticated users get no write grant at all, so the only way in is
-- the server action.
drop policy if exists firm_roles_select on firm_roles;
create policy firm_roles_select on firm_roles for select
  using (firm_id = public.current_firm_id());

drop policy if exists user_firm_roles_select on user_firm_roles;
create policy user_firm_roles_select on user_firm_roles for select
  using (firm_id = public.current_firm_id());

revoke all on firm_roles from anon, authenticated;
revoke all on user_firm_roles from anon, authenticated;
grant select on firm_roles to authenticated;
grant select on user_firm_roles to authenticated;

comment on table firm_roles is
  'A name + colour badge the firm owner defines and assigns, optionally carrying capabilities. Grants are ADDITIVE on top of users.permission_preset — a role can never take anything away. Distinct from client_members.position (a per-client label).';

-- Verify after applying:
--   select name, color, capabilities from firm_roles;    -- empty until one is made
--   select count(*) from user_firm_roles;                -- 0
--
-- Then make one in Settings > Team > Settings, give it to somebody, and check
-- it shows beside their name on their profile.
