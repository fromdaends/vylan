-- Being on a client's team lets you see it. Phase 3, slice 2 of 4.
--
-- WIDENING ONLY. Every change below adds an `or` branch to a USING clause.
-- Nobody who could see something yesterday loses it; some people can now see
-- more. That property is the whole reason this is a separate migration from
-- slice 3, which removes the old branch and is the one that can take sight
-- away.
--
-- Concretely: a staff member on a private client's team can now open that
-- client and its engagements. Before this, only the single assigned_user_id
-- could — so a client with three people working on it had two of them locked
-- out of their own work whenever it was marked private.
--
-- ── THE RECURSION TRAP, and why this is a function and not a subquery ───────
--
-- client_members' own policy (1210) calls client_is_private(client_id), which
-- reads `clients`. This migration teaches `clients`' policy to look at
-- client_members. Written as a plain subquery that is a loop:
--
--     clients_all → client_members → client_is_private → clients → clients_all…
--
-- and Postgres only discovers it at runtime, on the first query, in production.
--
-- SECURITY DEFINER breaks the cycle: inside the function, RLS on client_members
-- does not apply (the definer owns the table and FORCE ROW LEVEL SECURITY is
-- not set on it), so the inner policy never runs and never re-enters. This is
-- exactly the shape client_assigned_to_me (0990) already uses to read `clients`
-- from inside a policy on `engagements` — a proven pattern in this database,
-- not a new idea being tried on production.
--
-- The function is firm-self-scoped by construction: it matches on auth.uid(),
-- so it can only ever answer about the caller.
--
-- Reversible: restore the two policies from 0990 verbatim, then
--   drop function if exists public.client_has_member(uuid);

create or replace function public.client_has_member(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select exists (
      select 1 from public.client_members m
      where m.client_id = cid
        and m.user_id = auth.uid()
    )
  ), false)
$$;

comment on function public.client_has_member(uuid) is
  'True when the calling user is on the given client''s team (client_members, 1210). SECURITY DEFINER so a policy on clients can call it without re-entering client_members'' own policy. Used by clients_all / engagements_all.';

-- ── clients ────────────────────────────────────────────────────────────────
-- One new branch. Everything else is 0990 verbatim, including the WITH CHECK
-- arm — setting is_private stays owner-only, and slice 2 must not touch that.
drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (
      coalesce(is_private, false) = false
      or public.current_user_is_owner()
      or assigned_user_id = auth.uid()
      or public.client_has_member(id)
    )
  )
  with check (
    -- UNCHANGED from 0810/0990. This is what keeps is_private owner-only-settable.
    firm_id = public.current_firm_id()
    and (coalesce(is_private, false) = false or public.current_user_is_owner())
  );

-- ── engagements ────────────────────────────────────────────────────────────
-- The CLIENT gate gains the same branch. The engagement's OWN privacy gate is
-- untouched: being on a client's team does not open an engagement somebody
-- deliberately made private inside it. Two gates, two decisions.
drop policy if exists engagements_all on public.engagements;
create policy engagements_all on public.engagements for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        (
          not public.client_is_private(client_id)
          or public.client_assigned_to_me(client_id)
          or public.client_has_member(client_id)
        )
        and (
          coalesce(is_private, false) = false
          or assigned_user_id = auth.uid()
        )
      )
    )
  )
  with check (
    -- UNCHANGED from 0850/0990.
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and coalesce(is_private, false) = false
      )
    )
  );

comment on policy clients_all on public.clients is
  'Firm-scoped. Staff cannot see a private client UNLESS it is assigned to them (0990) OR they are on its team (1220). Writing a private row is still owner-only — the WITH CHECK arm is what enforces that.';

comment on policy engagements_all on public.engagements is
  'Firm-scoped. Staff cannot see a private engagement, or one under a private client, UNLESS it (or its client) is assigned to them (0990) or they are on the client''s team (1220). The engagement''s own privacy gate is independent of membership. Writing a private row is still owner-only.';

-- Verify after applying:
--   select public.client_has_member('<some client id>');   -- as a member: true
--
-- And the property that matters: sign in as a staff member and confirm their
-- client list has the same rows as before PLUS any private client they are on.
-- Nothing should have disappeared. If anything did, this migration is wrong and
-- 0990's two policies restore the previous behaviour exactly.
