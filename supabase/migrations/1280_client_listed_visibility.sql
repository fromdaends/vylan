-- The middle privacy level: "locked, here's who to ask".
--
-- Phase 3 of the Karbon roadmap asked for a state between the two we have.
-- After 1240 a client has exactly two: you are on its list and you see
-- everything, or you are not and the client does not exist for you. There is
-- nothing in between, so a staff member who needs something from a file they
-- are not on has no way to even learn it exists, let alone who to ask.
--
-- This adds one column with two values:
--
--   'members'  the behaviour shipped in 1240 and STILL THE DEFAULT — only
--              owners, the assignee and people on the list see the client at
--              all. Every existing row backfills to this, so applying this
--              migration alone changes nothing for anybody.
--
--   'listed'   the whole firm can see the client ROW — its name, and therefore
--              who to ask. Nothing else. Engagements, documents, money and
--              notes stay shut, because THIS MIGRATION DOES NOT TOUCH THEIR
--              POLICIES. That is the entire mechanism: widen the door on
--              `clients` and leave every other door where 1240 left it.
--
-- ⚠️ WHY THE CONTENT TABLES ARE SAFE WITHOUT BEING EDITED. engagements_all,
-- and everything that hangs off it, gate on client_assigned_to_me() or
-- client_has_member() — not on "can I see the client row". So a client going
-- 'listed' cannot leak a single engagement, document or payment. If a future
-- migration ever rewrites an engagement policy to lean on clients visibility
-- instead of membership, THAT is when this becomes a leak. Said here because
-- the connection is invisible from the other file.
--
-- WHAT 'listed' IS NOT: it is not a way to give somebody partial access to the
-- work. It is a directory entry. The client page renders a locked state naming
-- who to ask, and the app must keep it that way — a page that quietly showed
-- one more field each release would end up being 'members' by accretion.
--
-- WRITING IT is owner-only, enforced in the WITH CHECK below rather than only
-- in application code: making a client discoverable by the whole firm is a
-- privacy decision, and the two staff accounts must not be able to take it.
--
-- Idempotent throughout. Safe to run twice.

-- ── the column ─────────────────────────────────────────────────────────────
alter table public.clients
  add column if not exists visibility text not null default 'members';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_visibility_check'
  ) then
    alter table public.clients
      add constraint clients_visibility_check
      check (visibility in ('members', 'listed'));
  end if;
end $$;

comment on column public.clients.visibility is
  '''members'' (default) = only owners, the assignee and client_members see this client at all — the 1240 behaviour. ''listed'' = the whole firm sees the ROW so they know it exists and who to ask; engagements, documents and money stay closed because those policies gate on membership, not on client visibility.';

-- Every existing row is 'members' by the column default, which is exactly
-- today's behaviour. No backfill statement is needed and none is written: an
-- UPDATE here would be a no-op that reads like it is doing something.

-- ── who can SEE a client ───────────────────────────────────────────────────
-- One branch added to 1240's USING. Everything else is character-for-character
-- what 1240 left, including the load-bearing assigned_user_id branch (without
-- it the RETURNING read of a freshly inserted client is refused for non-owners
-- and creating a client fails).
--
-- The WITH CHECK gains ONE rule: only an owner may leave a row 'listed'. Note
-- it is written as "the value is not listed, OR you are an owner" so a staff
-- member editing a 'members' client is unaffected.
drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or assigned_user_id = auth.uid()
      or public.client_has_member(id)
      -- The middle level. Row only — see the note at the top about why this
      -- cannot reach the work.
      or coalesce(visibility, 'members') = 'listed'
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
  'Firm-scoped. A client is visible to firm owners, to the person it is assigned to, to anyone on its list (client_members), and — new in 1280 — to the whole firm when visibility = ''listed'', which exposes the ROW and nothing that hangs off it. Writing a private row, and marking a row listed, are both owner-only.';

-- Verify after applying:
--
--   -- 1. the column exists and everything is on the old behaviour:
--   select visibility, count(*) from clients group by visibility;
--   --> members | 101   (and no other row)
--
--   -- 2. as a STAFF member (Clarence), nothing has changed yet:
--   select count(*) from clients;   --> still just the ones he is on
--
--   -- 3. mark ONE client listed as the owner, then re-check as Clarence:
--   update clients set visibility = 'listed' where display_name = '<pick one>';
--   --> he now sees that row, and STILL sees no engagements for it:
--   select count(*) from engagements where client_id = '<that id>';  --> 0
--
-- Step 3 is the one that matters. If it returns anything but 0, an engagement
-- policy has been rewritten to lean on client visibility and the note at the
-- top of this file has come true.
