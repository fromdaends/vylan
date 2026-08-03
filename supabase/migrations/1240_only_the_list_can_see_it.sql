-- Only the people on a client's list can see it.
--
-- ⚠️ THIS ONE NARROWS ACCESS. Every other migration in this sequence added a
-- way in; this removes one. Until now a client that was not marked private was
-- visible to everybody in the firm. After this, the only people who can see a
-- client are:
--
--   * firm owners, always — they carry professional responsibility for every
--     file in the practice, and a tool that lets staff hide a client from the
--     principal is a liability, not a feature;
--   * the person it is assigned to;
--   * anyone on its list (client_members, 1210).
--
-- WHAT THIS DOES TO THE FOUNDER'S OWN DATA, measured before writing it rather
-- than guessed: 101 active clients, 22 people, and 20 of those 22 are owners.
-- Owners are unaffected by definition. The only people this can touch are the
-- two staff accounts — Clarence Junior (on 2 clients) and Zach Demo Outlook.
-- Everyone else sees exactly what they saw yesterday.
--
-- WHY assigned_user_id STAYS as a branch, when the 1210 backfill already made
-- every assignee a member and it looks redundant: it is what lets a non-owner
-- CREATE a client. The insert sets assigned_user_id in the same statement, but
-- the member row is written afterwards — so without this branch the RETURNING
-- read of a freshly inserted row would be refused by this very policy, and
-- creating a client would fail for everyone who is not an owner. It is load
-- bearing, not belt and braces.
--
-- ONE CLIENT HAS NOBODY ON ITS LIST ("Zachary Thresh" — it has no assignee, so
-- the 1210 backfill had nothing to copy). After this it is owner-visible only.
-- That is correct behaviour rather than a bug, and it is the shape of what
-- happens to any client whose list is left empty.
--
-- The WITH CHECK arms are UNCHANGED on both tables. Who may write a row, and
-- who may mark one private, are separate questions from who may see it, and
-- this migration answers only the last.
--
-- REVERSIBLE, and this is the one to know how to undo: re-run
-- 1220_membership_grants_sight.sql. It restores both policies to the state
-- immediately before this file, where being on the list only ever added access.

-- ── clients ────────────────────────────────────────────────────────────────
-- The removed branch is `coalesce(is_private, false) = false`.
drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or assigned_user_id = auth.uid()
      or public.client_has_member(id)
    )
  )
  with check (
    -- UNCHANGED from 0810/0990/1220.
    firm_id = public.current_firm_id()
    and (coalesce(is_private, false) = false or public.current_user_is_owner())
  );

-- ── engagements ────────────────────────────────────────────────────────────
-- The removed branch is `not public.client_is_private(client_id)`. The
-- engagement's OWN privacy gate is untouched: a private engagement stays
-- private to its assignee even for someone on the client's list. Two gates,
-- two decisions, same as 1220.
drop policy if exists engagements_all on public.engagements;
create policy engagements_all on public.engagements for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        (
          public.client_assigned_to_me(client_id)
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
    -- UNCHANGED from 0850/0990/1220.
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
  'Firm-scoped. A client is visible to firm owners, to the person it is assigned to, and to anyone on its list (client_members). Not being private no longer makes a client visible to the whole firm (1240). Writing a private row is still owner-only.';

comment on policy engagements_all on public.engagements is
  'Firm-scoped. Follows the client: you must be an owner, the client''s assignee, or on the client''s list. The engagement''s own privacy gate is independent and unchanged. Writing a private row is still owner-only.';

-- Verify after applying:
--   -- as an OWNER, nothing changes:
--   select count(*) from clients;                 -- every active client
--
--   -- as a STAFF member, they see their own list only:
--   select display_name from clients order by display_name;
--
-- And the one that actually matters: sign in as Clarence Junior and confirm he
-- sees the 2 clients he is on and no others — then add him to a third from its
-- "Who can see this" panel and confirm it appears.
