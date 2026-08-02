-- Who works on this client. Phase 3, slice 1 of 4.
--
-- ⚠️ THIS TABLE DOES NOT CONTROL ACCESS YET, AND NOTHING READS IT FOR
-- PERMISSIONS. Adding or removing a member here changes exactly nothing about
-- who can see a client today. That is the entire point of shipping it alone:
-- the phase that follows rewrites the row-level rules on `clients` and
-- `engagements`, the two tables 27 other rules hang off, and this project has
-- no staging database to rehearse a migration against. So the sequence is:
--
--   slice 1 (this)  the table exists and the firm fills it in. No behaviour change.
--   slice 2         the rules READ it alongside today's rule. Access can only widen.
--   slice 3         today's rule is removed. Access narrows to membership.
--   slice 4         the middle privacy level, and "who can see this?".
--
-- Each is reversible on its own, and nobody is ever locked out of their own
-- data between two of them.
--
-- WHY THE BACKFILL IS NOT OPTIONAL. By slice 3 an empty cast means nobody can
-- see the client. If this table shipped empty and the firm never filled it in,
-- flipping the switch would blank every staff member's client list at once. So
-- every client that already names somebody (clients.assigned_user_id, 0210)
-- starts with that person in the cast, and slice 3 has a floor to stand on.
--
-- POSITION IS FREE TEXT AND STARTS NULL. The firm names its own positions —
-- "Manager", "Preparer", "Reviewer" — and seeding "Owner" here would invent a
-- vocabulary before anyone asked for one, on top of colliding with the firm
-- owner, who is a different thing entirely.
--
-- Reversible: drop table client_members.

create table if not exists client_members (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- references users, not auth.users: leaving the firm should take you off
  -- every client you were on, and users is where deactivation lives.
  user_id uuid not null references users(id) on delete cascade,
  -- The firm's own word for what this person does on this client. Null means
  -- "on the client, unlabelled", which is a normal and permanent state.
  position text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- A person is on a client once. This is also the upsert target, so adding
-- somebody twice is a no-op rather than a second row.
create unique index if not exists client_members_client_user_idx
  on client_members (client_id, user_id);

-- "Which clients is this person on" — the question slice 2's policy asks on
-- every single row read, so it gets its own index before it is ever asked.
create index if not exists client_members_user_idx
  on client_members (user_id);

create index if not exists client_members_firm_idx
  on client_members (firm_id);

alter table client_members enable row level security;

-- Same shape as month_end_closes (1160) and organize_suggestions (1140): firm
-- isolation plus the private-client cascade. Knowing who works on a private
-- client is exactly as restricted as knowing that client exists.
--
-- NOTE for slice 2: this policy reads client_is_private(client_id), and slice 2
-- will teach the CLIENTS policy to read client_members. Two tables whose
-- policies read each other is how you get infinite recursion — so slice 2 must
-- go through a SECURITY DEFINER helper (like client_assigned_to_me in 0990),
-- never a direct subquery. Writing it down here because the trap is invisible
-- until Postgres throws at runtime, on production, with no staging to catch it.
drop policy if exists client_members_all on client_members;
create policy client_members_all on client_members for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

revoke all on client_members from anon, authenticated;
grant select, insert, update, delete on client_members to authenticated;

comment on table client_members is
  'Who works on a client. Phase 3 slice 1: descriptive only — nothing reads this for access control until slice 2.';

-- The floor slice 3 stands on: every client that already names somebody keeps
-- that person. Idempotent, so re-running this file changes nothing.
insert into client_members (firm_id, client_id, user_id)
select c.firm_id, c.id, c.assigned_user_id
from clients c
where c.assigned_user_id is not null
on conflict (client_id, user_id) do nothing;

-- Verify after applying:
--   select count(*) from client_members;                    -- one per assigned client
--   select c.display_name, u.name
--     from client_members m
--     join clients c on c.id = m.client_id
--     join users u on u.id = m.user_id
--    order by c.display_name;
--
-- And confirm nothing changed: sign in as a staff member and check their client
-- list is exactly what it was before this ran.
