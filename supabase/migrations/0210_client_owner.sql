-- Client ownership — each client belongs to a firm member.
--
-- Mirrors engagements.assigned_user_id (since 0001): a nullable FK to users
-- with ON DELETE SET NULL. This is ACCOUNTABILITY, not access control —
-- clients stay firm-scoped (the clients_all RLS policy, 0002), so every member
-- still sees every client. The column powers the "My clients / All firm"
-- filter and the per-client owner badge on /clients.
--
-- WRITABILITY: unlike users/firms (whose authenticated UPDATE was locked to a
-- column whitelist in 0039/0059), `clients` has NO column whitelist, and the
-- clients_all policy already lets any firm member insert/update their own
-- firm's rows. So assigned_user_id is writable by the authed client — which is
-- what createClient / bulkCreateClients rely on to set the owner to the
-- creating user. No new GRANT/policy is needed.

alter table clients
  add column if not exists assigned_user_id uuid references users(id) on delete set null;

create index if not exists clients_assigned_user_idx
  on clients (assigned_user_id);

comment on column clients.assigned_user_id is
  'The firm member who owns this client (accountability only — clients stay firm-scoped and visible to all members). Set to the creating user on create; NULL = unassigned. Mirrors engagements.assigned_user_id.';

-- Backfill existing clients to their firm owner (founder choice: the owner''s
-- "My clients" should show the existing book immediately, rather than starting
-- empty with everything "Unassigned").
--
-- Idempotent: only touches rows still NULL, so re-running is harmless. A firm
-- has a single owner (the team feature enforces this via transfer-ownership);
-- order-by-created_at + limit 1 is a safe tie-breaker if that ever changes.
update clients c
set assigned_user_id = (
  select u.id
  from users u
  where u.firm_id = c.firm_id
    and u.role = 'owner'
    and u.deactivated_at is null
  order by u.created_at asc
  limit 1
)
where c.assigned_user_id is null;

------------------------------------------------------------------------------
-- VERIFICATION (run interactively after applying; cannot run in CI — no test DB)
------------------------------------------------------------------------------
-- 1) Column exists + backfilled:
--      select count(*) filter (where assigned_user_id is null) as unassigned,
--             count(*) as total
--      from clients;                          -> unassigned should be 0 for
--                                                firms that have an owner.
-- 2) A firm member can set it (no column-lock): signed in as any member,
--      insert into clients (firm_id, display_name, assigned_user_id)
--      values (current_firm_id(), 'RLS test', auth.uid());   -> succeeds.
