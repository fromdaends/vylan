-- Let one person into ONE job, without opening the whole client.
--
-- The last item of phase 3. Membership so far has been a property of the
-- CLIENT: you are on the client, so you see everything under it. That is the
-- right default and the wrong only option — "have a look at this one return"
-- should not mean "here is everything we do for this company, including last
-- year's, the invoices and the bank feed".
--
-- ── ONE FUNCTION CHANGE DOES MOST OF THE WORK, and that is not a shortcut ────
--
-- Ten child tables (documents, uploaded_files, final_documents,
-- payment_requests, chat, recurring occurrences and the rest) all gate their
-- read arm on the SAME helper: `not engagement_is_private(engagement_id)`.
-- They do not each carry their own copy of the rule, which is what makes this
-- tractable — teaching that ONE function about explicit membership opens
-- exactly the right ten doors at once, and cannot open an eleventh by accident.
--
-- If those ten had been ten hand-written copies, this migration would be the
-- kind of change that ships a hole in it.
--
-- ── WHAT BEING ON ONE JOB GETS YOU ──────────────────────────────────────────
--
--   the engagement           yes — engagements_all gains a branch
--   its documents and files  yes — via engagement_is_private, as above
--   the client's NAME        yes — clients_all gains a narrow branch, or the
--                            engagement renders attributed to "—"
--   the client's OTHER work  NO. Nothing here touches client membership, so
--                            every other engagement stays exactly as hidden as
--                            it was.
--   the client's page        the row resolves, but the page itself shows the
--                            locked state from 1280 unless they are also on
--                            the client.
--
-- ── PRIVATE STILL MEANS PRIVATE, DELIBERATELY OVERRIDDEN HERE ───────────────
--
-- engagement_is_private() is true when the CLIENT is private or the ENGAGEMENT
-- is. Explicit membership beats both, and that is the point rather than a leak:
-- "let one person into one job without opening the whole client" is exactly the
-- private-client case. An owner adding somebody is a deliberate act on one row.
--
-- The WITH CHECK arms are untouched everywhere. Who may SEE a thing and who may
-- mark it private are separate questions, and this file answers only the first.
--
-- Idempotent throughout. Safe to run twice.

create table if not exists engagement_members (
  engagement_id uuid not null references engagements(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  primary key (engagement_id, user_id)
);

create index if not exists engagement_members_user_idx
  on engagement_members (user_id);
create index if not exists engagement_members_firm_idx
  on engagement_members (firm_id);

alter table engagement_members enable row level security;

-- ── helper ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER for the usual reason: this is read from inside the
-- engagements policy, and a policy on `engagements` that reads a table whose
-- own policy reads `engagements` is infinite.
create or replace function public.engagement_has_member(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from engagement_members em
     where em.engagement_id = eid and em.user_id = auth.uid()
  );
$$;

comment on function public.engagement_has_member(uuid) is
  'True when the caller was explicitly added to this ONE engagement (1310). Beats both privacy flags on purpose — "into one job without opening the whole client" is exactly the private-client case.';

-- ── the ten child tables, via the helper they all already share ────────────
create or replace function public.engagement_is_private(eid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    -- Explicitly on this job: it is not private TO YOU. Every child table's
    -- read arm asks this one question, so this single branch is what lets a
    -- per-engagement member open the documents and files under it.
    when public.engagement_has_member(eid) then false
    else coalesce((
      select (c.is_private or e.is_private)
      from public.engagements e
      join public.clients c on c.id = e.client_id
      where e.id = eid and e.firm_id = public.current_firm_id()
    ), false)
  end
$$;

comment on function public.engagement_is_private(uuid) is
  'True if the engagement or its client is marked private AND the caller is not explicitly on the engagement (1310). Security-definer; read by ten child-table policies, which is why the membership branch lives here rather than in each of them.';

-- ── the engagement itself ──────────────────────────────────────────────────
-- 1240's policy with ONE branch added. The client-membership arm and the
-- engagement's own privacy gate are untouched for everybody else.
drop policy if exists engagements_all on public.engagements;
create policy engagements_all on public.engagements for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.engagement_has_member(id)
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
    -- UNCHANGED from 0850/0990/1220/1240.
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and coalesce(is_private, false) = false
      )
    )
  );

-- ── just enough of the client for the row to render ────────────────────────
-- Without this the engagement appears attributed to "—". It grants the ROW and
-- nothing else: every other client-scoped policy still asks client membership.
create or replace function public.on_an_engagement_for_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from engagement_members em
      join engagements e on e.id = em.engagement_id
     where em.user_id = auth.uid() and e.client_id = cid
  );
$$;

drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or assigned_user_id = auth.uid()
      or public.client_has_member(id)
      or public.on_an_engagement_for_client(id)
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

-- ── the membership table's own policy ──────────────────────────────────────
-- Readable by anyone who can see the engagement, so "who else is on this?"
-- resolves. Writes go through the service-role client in the actions layer,
-- gated there, like every other roster write.
drop policy if exists engagement_members_select on engagement_members;
create policy engagement_members_select on engagement_members for select
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.engagement_has_member(engagement_id)
      or not public.engagement_is_private(engagement_id)
    )
  );

revoke all on engagement_members from anon, authenticated;
grant select on engagement_members to authenticated;

comment on table engagement_members is
  'People let into ONE engagement without being on its client (1310). Additive: it never removes access somebody already had through the client.';

-- Verify after applying:
--
--   -- 1. nothing changes until somebody is added:
--   select count(*) from engagement_members;   --> 0
--
--   -- 2. add a staff member to ONE engagement of a client they are NOT on:
--   insert into engagement_members (engagement_id, user_id, firm_id)
--   values ('<engagement id>', '<their user id>', '<firm id>');
--
--   -- then, signed in as them:
--   select count(*) from engagements where id = '<that engagement id>';  --> 1
--   select count(*) from engagements where client_id = '<that client>';  --> 1
--          ^ ONE, not all of them. If this returns more, the client-membership
--            arm has been widened by accident and the feature leaks the client.
--   select count(*) from uploaded_files where engagement_id = '<that one>'; --> its files
--
--   -- 3. and the client row resolves by NAME only:
--   select display_name from clients where id = '<that client>';   --> 1 row
--
-- Step 2's second query is the one that matters. Everything else is additive;
-- that one is the boundary this whole feature is defined by.
