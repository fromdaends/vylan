-- 0990_assigned_staff_can_see.sql
--
-- A staff member can SEE a client that is assigned to them, and its engagements.
--
-- THE PROBLEM THIS FIXES. 0840 made "clients private by default" the posture for
-- every new firm. An owner then creates their clients (stamped private) and
-- their engagements (also stamped private), invites their first teammate — and
-- that teammate opens Vylan to zero clients and zero engagements, with nothing
-- on screen explaining why. Privacy was rank-based: owners see everything,
-- staff see nothing private, and being handed the work changed nothing.
--
-- THE NARROW FIX. Assignment already means "this is yours to do". Let it also
-- mean "you can see it". Nothing else about the model changes: privacy is still
-- owner-set, still hides from everyone else, and a staff member still sees
-- nothing they haven't been given.
--
-- ============================================================================
-- READ ONLY, DELIBERATELY — and this is the important caveat.
-- ============================================================================
-- Only the USING arms change. The WITH CHECK arms are untouched, so an assigned
-- staff member can READ a private client or engagement but not UPDATE it while
-- it is private.
--
-- Why not open writes too: WITH CHECK evaluates the NEW row and cannot see the
-- OLD one, so there is no way to say "you may write this, but you may not flip
-- is_private" in a policy — the arms are OR'd, and setting is_private = false
-- satisfies the public arm no matter what. The only mechanism that can express
-- it is a trigger, and a trigger keyed on current_user_is_owner() would ALSO
-- fire for the service role (auth.uid() is null there, so the function returns
-- false) and break the existing setClientsPrivateDefault backfill.
--
-- The direct is_private reference in WITH CHECK is what makes the flag
-- owner-only-settable at the database layer (0810's own comment says so). That
-- guarantee is worth more than the convenience, especially since Phase 3 of the
-- team plan replaces this whole model with real per-client membership — any
-- trigger written now would be thrown away with it.
--
-- Nothing REGRESSES: today an assigned staff member cannot see these rows at
-- all, so read-only is strictly more than they had. The known rough edge is
-- that a staff member assigned a PRIVATE engagement can open it but cannot mark
-- it complete; the owner's per-item privacy toggle is the escape hatch until
-- Phase 3.

-- Firm-self-scoped, like every other helper added in 0810. The scoping is not
-- decoration: these helpers keep their default EXECUTE-to-PUBLIC grant (0810
-- documents WHY — revoking it breaks every authed read, because Postgres checks
-- EXECUTE on the caller even inside a policy), so a body without the firm check
-- would be a cross-firm oracle over a callable RPC.
--
-- Needed as a definer function rather than a subquery because `clients` is
-- itself RLS-gated: a bare subquery from inside engagements_all returns no row
-- for a staff member and reads as false — the RLS-in-subquery trap 0810 hit
-- with chat_messages and recurring_occurrences.
create or replace function public.client_assigned_to_me(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.assigned_user_id = auth.uid()
    from public.clients c
    where c.id = cid and c.firm_id = public.current_firm_id()
  ), false)
$$;

comment on function public.client_assigned_to_me(uuid) is
  'True when the given client is assigned to the calling user (clients.assigned_user_id, 0210). Firm-self-scoped. Used by clients_all / engagements_all so a staff member can see work handed to them even when it is private.';

-- clients: reads its own assigned_user_id directly — same table, so no helper
-- and no subquery is involved.
drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (
      coalesce(is_private, false) = false
      or public.current_user_is_owner()
      or assigned_user_id = auth.uid()
    )
  )
  with check (
    -- UNCHANGED from 0810. See the header: this is what keeps is_private
    -- owner-only-settable.
    firm_id = public.current_firm_id()
    and (coalesce(is_private, false) = false or public.current_user_is_owner())
  );

-- engagements: two independent privacy gates, so both need the assigned escape.
-- The CLIENT gate uses the helper (different, RLS-gated table); the engagement's
-- OWN gate reads its column directly and pairs with engagements.assigned_user_id.
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
        )
        and (
          coalesce(is_private, false) = false
          or assigned_user_id = auth.uid()
        )
      )
    )
  )
  with check (
    -- UNCHANGED from 0850.
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
  'Firm-scoped. Staff cannot see a private client UNLESS it is assigned to them (0990). Writing a private row is still owner-only — the WITH CHECK arm is what enforces that.';

comment on policy engagements_all on public.engagements is
  'Firm-scoped. Staff cannot see a private engagement, or one under a private client, UNLESS it (or its client) is assigned to them (0990). Writing a private row is still owner-only.';

-- ============================================================================
-- WHAT THE CHILDREN DO — checked table by table, not assumed.
-- ============================================================================
-- The children split into two mechanisms, and they behave differently here:
--
--   CASCADE FOR FREE. request_items and uploaded_files (0002) gate on
--   `exists (select 1 from engagements e where e.id = ... and e.firm_id = ...)`.
--   That subquery reads the RLS-gated engagements table, so it inherits
--   whatever engagements_all decides. The moment an assigned staff member can
--   see the engagement, they can see its checklist and its uploaded files.
--   This is what makes the fix actually useful rather than cosmetic: the
--   document-collection work is exactly the work being handed over.
--
--   STAY HIDDEN. final_documents, file_comments, payment_requests,
--   signature_requests, activity_log, chat and the QBO/Xero caches gate on the
--   SECURITY DEFINER helper engagement_is_private(), which is deliberately NOT
--   touched here. So deliverables, internal comments, invoices and history on a
--   PRIVATE engagement remain owner-only.
--
-- That split is the intended shape for a narrow fix: enough to do the job that
-- was handed to you, conservative about money, deliverables and internal
-- conversation. Widening the definer helpers means re-deciding visibility for
-- ~26 tables in one go, which is Phase 3's work.
