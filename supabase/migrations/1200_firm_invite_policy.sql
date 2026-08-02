-- Who may invite a teammate.
--
-- The first setting in the firm's Security section (Phase 2). Today inviting is
-- hard-coded to owners, which is one of the 98 copy-pasted owner checks the
-- capability model exists to replace — and the one firms ask about first, since
-- an office manager who cannot add the new hire has to interrupt the principal
-- to do it.
--
-- THE RLS TRAP THIS MIGRATION EXISTS TO CLOSE, and the reason the capability
-- model deliberately left team.manage owner-only until now:
--
--   firm_invites carries exactly one policy, firm_invites_select_owner (0190),
--   and it is literally owner-only. Writes never touch it — every roster write
--   goes through the service-role client, which bypasses RLS entirely. So
--   granting a member the right to INVITE without touching this policy would
--   have handed them a working invite button above a permanently EMPTY list of
--   pending invites: they could send one, then never see it, revoke it or
--   resend it. src/lib/auth/capabilities.ts predicted this in as many words.
--
-- The fix is a SECURITY DEFINER helper, the same shape as current_user_is_owner
-- and client_is_private. Definer rights matter: the function reads `firms`, and
-- calling it from a policy on firm_invites must not re-enter RLS.
--
-- DEFAULT 'owner'. Every existing firm keeps exactly today's behaviour, and a
-- firm that never opens the setting never changes. The looser value is a
-- decision somebody makes on purpose, which is the only acceptable default for
-- anything under a heading marked Security.
--
-- Reversible:
--   -- restore the original policy from 0190, then:
--   drop function if exists public.current_firm_allows_member_invites();
--   alter table firms drop column if exists invite_policy;

alter table firms
  add column if not exists invite_policy text not null default 'owner'
    check (invite_policy in ('owner', 'members'));

comment on column firms.invite_policy is
  'Who may invite teammates: ''owner'' (default) or ''members''. Enforced in app/actions/team.ts AND by the firm_invites select policy below.';

-- True when the CALLER's own firm lets members invite. Deliberately takes no
-- argument: a policy asking "may this row be seen" is always asking about the
-- caller's firm, and an argument would invite a call site that passes some
-- other firm's id.
create or replace function public.current_firm_allows_member_invites()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.firms f
    where f.id = public.current_firm_id()
      and f.invite_policy = 'members'
  )
$$;

-- Same policy name as 0190 so this replaces it rather than stacking a second
-- permissive rule beside it (two SELECT policies OR together, which is how a
-- "tightening" migration accidentally loosens a table).
drop policy if exists firm_invites_select_owner on firm_invites;
create policy firm_invites_select_owner on firm_invites for select
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.current_firm_allows_member_invites()
    )
  );

-- Verify after applying:
--   select id, name, invite_policy from firms;              -- all 'owner'
--   select public.current_firm_allows_member_invites();     -- false
--
-- Then set one firm to 'members' and re-run the second query as a member of
-- that firm — it should flip to true, and their pending-invite list should
-- stop being empty.
