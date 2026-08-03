-- Make the Owner role a REAL role.
--
-- The founder, looking at the Members panel and finding themself filed under
-- "No role": "it says I have it on the actual overview of people, but
-- technically it's not an actual role. So just make the role real."
--
-- They were right, and the gap was exactly that. "Owner" was a RANK
-- (users.role) that the roster rendered as a pill. It looked like a badge and
-- behaved like nothing — it could not be seen in the roles list, could not be
-- grouped by, and left the firm's principal in the "no role" bucket of their
-- own member list.
--
-- After this there is one role per firm marked is_owner_role, every owner wears
-- it, and nobody has to remember to attach it.
--
-- ── WHAT THIS DOES NOT CHANGE: WHO CAN DO WHAT ──────────────────────────────
--
-- Not one permission moves. capabilitiesFor() gives an owner every capability
-- from users.role alone and consults nothing else, which is deliberate: the
-- rank is what RLS enforces, and letting any other input demote an owner would
-- lock them out of their own firm with no way back. So the owner role's
-- capabilities column stays EMPTY and is never read. It is a badge that tells
-- the truth about a rank decided elsewhere.
--
-- That is also why the app refuses to edit its permissions rather than showing
-- switches that are all on: switches imply you could turn one off, and turning
-- one off here would do nothing at all.
--
-- ── AUTOMATIC, VIA TRIGGERS, NOT VIA APPLICATION CODE ───────────────────────
--
-- The founder's words were "at all times". Application code cannot promise
-- that: a firm can be created by signup, by an invite accept, or by a backfill,
-- and every one of those paths would have to remember. Triggers cannot forget.
--
--   * a new firm gets its Owner role on insert
--   * a user who becomes an owner is given it
--   * a user who stops being an owner has it taken away
--
-- ── THE NAME COLLISION, HANDLED RATHER THAN AVOIDED ─────────────────────────
--
-- firm_roles has a unique index on (firm_id, lower(name)), so a firm that has
-- already made its own role called "Owner" would break a naive insert. Instead
-- of picking a different name and leaving the firm with two Owners, the
-- function PROMOTES the existing row — it becomes the real one, keeping its
-- colour and its members. That is almost certainly what the firm meant by it.
--
-- Idempotent throughout. Safe to run twice.

-- ── the flag ───────────────────────────────────────────────────────────────
alter table public.firm_roles
  add column if not exists is_owner_role boolean not null default false;

comment on column public.firm_roles.is_owner_role is
  'True for the ONE automatic role every firm owner wears. Membership is maintained by trigger, not by hand; the app refuses to delete it, edit its permissions, or change who is in it. Its capabilities column is empty and never read — an owner gets everything from users.role.';

-- One per firm, enforced by the database rather than by hope.
create unique index if not exists firm_roles_one_owner_role_idx
  on public.firm_roles (firm_id) where is_owner_role;

-- ── ensure the role exists for a firm, and return it ───────────────────────
create or replace function public.ensure_owner_role(p_firm_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
begin
  select id into v_role_id
    from firm_roles
   where firm_id = p_firm_id and is_owner_role
   limit 1;
  if v_role_id is not null then
    return v_role_id;
  end if;

  -- A firm that already made its own "Owner" keeps that row — colour, members
  -- and all — and it simply becomes the real one. Two roles both called Owner
  -- would be worse than either outcome.
  select id into v_role_id
    from firm_roles
   where firm_id = p_firm_id and lower(name) = 'owner'
   limit 1;
  if v_role_id is not null then
    update firm_roles set is_owner_role = true where id = v_role_id;
    return v_role_id;
  end if;

  insert into firm_roles (firm_id, name, color, capabilities, is_owner_role)
  values (p_firm_id, 'Owner', 'amber', '{}', true)
  returning id into v_role_id;
  return v_role_id;
end;
$$;

-- ── keep membership true to users.role ─────────────────────────────────────
create or replace function public.sync_owner_role_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
begin
  if new.firm_id is null then
    return new;
  end if;

  if new.role = 'owner' then
    v_role_id := public.ensure_owner_role(new.firm_id);
    insert into user_firm_roles (user_id, role_id, firm_id)
    values (new.id, v_role_id, new.firm_id)
    on conflict (user_id, role_id) do nothing;
  else
    -- Demoted, or moved to another firm. Take the badge with the rank — a
    -- former owner still wearing "Owner" is the exact lie this file exists to
    -- remove.
    delete from user_firm_roles ufr
     using firm_roles fr
     where ufr.role_id = fr.id
       and ufr.user_id = new.id
       and fr.is_owner_role;
  end if;
  return new;
end;
$$;

drop trigger if exists users_sync_owner_role on public.users;
create trigger users_sync_owner_role
  after insert or update of role, firm_id on public.users
  for each row execute function public.sync_owner_role_membership();

-- ── a brand-new firm gets one immediately ──────────────────────────────────
-- Before its first owner row exists, so the roles list is never briefly empty
-- on a firm that has just been created.
create or replace function public.create_owner_role_for_firm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_owner_role(new.id);
  return new;
end;
$$;

drop trigger if exists firms_create_owner_role on public.firms;
create trigger firms_create_owner_role
  after insert on public.firms
  for each row execute function public.create_owner_role_for_firm();

-- ── backfill every firm that already exists ────────────────────────────────
do $$
declare
  r record;
  v_role_id uuid;
begin
  for r in select id from firms loop
    v_role_id := public.ensure_owner_role(r.id);
    insert into user_firm_roles (user_id, role_id, firm_id)
    select u.id, v_role_id, r.id
      from users u
     where u.firm_id = r.id and u.role = 'owner'
    on conflict (user_id, role_id) do nothing;
  end loop;
end $$;

-- Verify after applying:
--
--   -- 1. exactly one per firm, and it is called Owner:
--   select f.name, fr.name, fr.color, fr.is_owner_role
--     from firms f join firm_roles fr on fr.firm_id = f.id and fr.is_owner_role;
--
--   -- 2. every owner wears it, and nobody else does:
--   select u.email, u.role
--     from users u
--     join user_firm_roles ufr on ufr.user_id = u.id
--     join firm_roles fr on fr.id = ufr.role_id and fr.is_owner_role;
--   --> exactly the rows where u.role = 'owner'
--
--   -- 3. the trigger works. Promote and demote a test staff row and re-run 2.
--
-- On the founder's own firm this should list Tyler Jette and nobody else, and
-- the Members panel should stop filing him under "No role".
