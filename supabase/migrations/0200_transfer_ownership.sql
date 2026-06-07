-- Team / multi-user — transfer firm ownership (atomic role swap).
--
-- Swapping two users' roles is two writes that MUST land together — otherwise a
-- failure between them leaves the firm with two owners or none. A column-level
-- CASE update can't be expressed through PostgREST, so we do it in a single SQL
-- statement inside a SECURITY DEFINER function.
--
-- SECURITY: the function is owner-defined so it bypasses the column-lock that
-- stops `authenticated` from writing users.role (0039). That makes EXECUTE
-- access the whole security boundary — so we revoke it from public / anon /
-- authenticated and grant it ONLY to service_role. The transferOwnership server
-- action (which first verifies the caller is the firm's owner) calls it via the
-- service-role client. A logged-in user can NOT call it directly to crown
-- themselves.
--
-- The WHERE clause scopes the swap to the two named users within one firm, so a
-- bad argument can't touch any other row.

create or replace function public.transfer_firm_ownership(
  p_firm_id uuid,
  p_old_owner uuid,
  p_new_owner uuid
) returns void
language sql
security definer
set search_path = public
as $$
  update public.users
  set role = case
    when id = p_old_owner then 'staff'::user_role
    when id = p_new_owner then 'owner'::user_role
  end
  where firm_id = p_firm_id
    and id in (p_old_owner, p_new_owner);
$$;

revoke all on function public.transfer_firm_ownership(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.transfer_firm_ownership(uuid, uuid, uuid)
  to service_role;

comment on function public.transfer_firm_ownership(uuid, uuid, uuid) is
  'Atomically swaps owner<->staff for two users in one firm. Service-role-only; called by the transferOwnership server action after it verifies the caller is the current owner.';
