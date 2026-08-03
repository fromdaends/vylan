-- The outsider: somebody who works on a file without joining the firm.
--
-- Last piece of phase 3, and the reason it comes last is that it is restricted
-- on the OPPOSITE AXIS from everything before it. A Junior saw every client and
-- was limited in what they could DO. A contractor may need to do everything on
-- one file and is limited in WHICH FILES EXIST FOR THEM. That is why it could
-- never have been a third preset on the same switch list — it needs membership,
-- which is what the rest of this phase built.
--
-- ── NOT A THIRD RANK ────────────────────────────────────────────────────────
--
-- users.role stays 'owner' | 'staff', forever, because RLS is written against
-- it and a third value means re-deciding every policy in the schema. An
-- outsider is a STAFF row with a flag. The flag NARROWS; it never widens, so a
-- policy that forgets to check it is too generous rather than broken — and
-- every place that matters is checked below.
--
-- ── THE FOUNDER'S TWO DECISIONS, both taken as the industry default ─────────
--
--   1. "Should an outsider see your other staff and your full client list?"
--      NO. Notion and Slack (guests), GitHub (outside collaborators), Linear
--      (Guest) and Asana all scope a guest to what they were invited to.
--
--   2. "Should an outsider consume a paid seat?"
--      NO. Same products either exclude guests from the licence count or bill
--      them separately. Enforced in application code (lib/billing/seats.ts),
--      not here — the cap is a product rule, not a data rule.
--
-- ── WHAT AN OUTSIDER CAN SEE, EXACTLY ───────────────────────────────────────
--
--   clients      only the ones they are ON. NOT 'listed' ones (1280): "the
--                whole firm can see this exists" means the FIRM, and an
--                outsider is not the firm. This is the one line of 1280 that
--                has to change, and forgetting it would have leaked the name
--                of every listed client to every contractor.
--   engagements  unchanged — already gated on membership, not on rank.
--   users        themselves, the firm's owners (so "who to ask" resolves), and
--                anyone they share a client with (so an assignee's name still
--                renders on their own work). NOT the rest of the roster.
--
-- Idempotent throughout. Safe to run twice.

-- ── the flag ───────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists is_external boolean not null default false;

comment on column public.users.is_external is
  'True for an OUTSIDE COLLABORATOR — a contractor scoped to the clients they are on. Still users.role = ''staff''; this flag only ever NARROWS. They do not see the firm roster, do not see ''listed'' clients (1280), and do not consume a seat (enforced in lib/billing/seats.ts).';

-- Carried on the invite so somebody is invited AS an outsider and the flag is
-- set at accept time, rather than being flipped afterwards by hand.
alter table public.firm_invites
  add column if not exists is_external boolean not null default false;

-- ── helpers ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER for the same reason every other helper here is: a policy on
-- `users` that reads `users` is infinite.
create or replace function public.current_user_is_external()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.is_external from users u where u.id = auth.uid()),
    false
  );
$$;

-- "Do they and I appear on the same client?" Used to keep an assignee's NAME
-- readable on work an outsider can already see. Without it their own
-- engagement list renders rows attributed to nobody.
create or replace function public.shares_a_client_with_me(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from client_members mine
      join client_members theirs on theirs.client_id = mine.client_id
     where mine.user_id = auth.uid()
       and theirs.user_id = p_user_id
  );
$$;

-- ── the roster narrows, and ONLY for an outsider ───────────────────────────
-- Everyone else keeps exactly the 0002 policy. Written so the ordinary case is
-- the first branch and short-circuits: a firm with no outsiders pays one
-- boolean for this.
drop policy if exists users_select on public.users;
create policy users_select on public.users for select
  using (
    firm_id = public.current_firm_id()
    and (
      not public.current_user_is_external()
      or id = auth.uid()
      or role = 'owner'
      or public.shares_a_client_with_me(id)
    )
  );

comment on policy users_select on public.users is
  'Firm-scoped. A normal member sees the whole roster. An OUTSIDE COLLABORATOR (users.is_external, 1300) sees only themselves, the firm''s owners, and people they share a client with.';

-- ── a listed client is visible to the FIRM, not to an outsider ─────────────
-- Character-for-character 1280, with one branch narrowed. Everything else,
-- including the load-bearing assigned_user_id branch, is unchanged.
drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or assigned_user_id = auth.uid()
      or public.client_has_member(id)
      or (
        coalesce(visibility, 'members') = 'listed'
        and not public.current_user_is_external()
      )
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (coalesce(is_private, false) = false or public.current_user_is_owner())
    and (
      coalesce(visibility, 'members') <> 'listed'
      or public.current_user_is_owner()
    )
  );

comment on policy clients_all on public.clients is
  'Firm-scoped. Visible to firm owners, the assignee, anyone on its list (client_members), and — when visibility = ''listed'' (1280) — to the whole firm EXCEPT outside collaborators (1300). Writing a private row, and marking a row listed, are both owner-only.';

-- Verify after applying:
--
--   -- 1. nobody is an outsider yet, so nothing has changed for anybody:
--   select count(*) from users where is_external;   --> 0
--
--   -- 2. make one, then sign in as them:
--   update users set is_external = true where email = '<a staff account>';
--   select count(*) from users;      --> themselves + the owners + shared
--   select count(*) from clients;    --> only the ones they are ON
--
--   -- 3. and the one that would be a leak if the branch above were missed:
--   update clients set visibility = 'listed' where display_name = '<any>';
--   --> that client must still NOT appear for them.
--
-- Put the account back with `update users set is_external = false ...` when done.
