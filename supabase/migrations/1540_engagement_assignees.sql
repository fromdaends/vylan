-- Several people can be accountable for one engagement.
--
-- Founder, twice: "Theres no way still to add an assignee." Canopy shows a row
-- of faces on a job with a "+" to add more; Vylan has had exactly one name.
--
-- ── WHY A NEW TABLE AND NOT A COLUMN ON engagement_members ─────────────────
--
-- Because they answer different questions, and the founder's own question this
-- session was precisely the right one: "is there an actual foundation for
-- people to work on the same engagement?" There is, and it is ACCESS:
--
--   client_members (1210)      you are on the CLIENT, so you see all its work
--   engagement_members (1320)  you were let into ONE job without the client
--   engagements.assigned_user_id  who is ACCOUNTABLE. Exactly one person.
--
-- So "can see it" was already many and "is responsible for it" was one. Adding
-- a kind column to engagement_members would have collapsed those two into one
-- table, and they have different lifecycles: an assignee should imply access,
-- but access must never imply accountability. Somebody let in to glance at a
-- return is not answerable for it.
--
-- ── assigned_user_id SURVIVES AS THE PRIMARY ───────────────────────────────
--
-- Deliberately not migrated away. Six places read it (the worklist column,
-- selectAssignedTo, the reassign menu, handoff, attention scoring, bulk
-- assign) and an engagement still benefits from ONE name that owns it. This
-- table is the full set INCLUDING that person; the column is a pointer into
-- the set saying which of them is answerable.
--
-- Readers union the two, so a row written before this migration — with a
-- primary and no rows here — still reads correctly as "one assignee". Nothing
-- needs backfilling, and an unapplied migration degrades to today's behaviour
-- rather than an empty list.
--
-- ── BEING ASSIGNED LETS YOU OPEN IT ────────────────────────────────────────
--
-- Assigning work to somebody who cannot see it is not a state worth
-- supporting. So this widens sight the same way 1320 did, through the same
-- three seams, and WIDENING ONLY: every branch below is an added `or`. Nobody
-- who could see something yesterday loses it.
--
-- Idempotent throughout. Safe to run twice.

create table if not exists engagement_assignees (
  engagement_id uuid not null references engagements(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  primary key (engagement_id, user_id)
);

create index if not exists engagement_assignees_user_idx
  on engagement_assignees (user_id);
create index if not exists engagement_assignees_engagement_idx
  on engagement_assignees (engagement_id);
create index if not exists engagement_assignees_firm_idx
  on engagement_assignees (firm_id);

alter table engagement_assignees enable row level security;

-- ── helper ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER for 1320's reason exactly: this is read from inside the
-- engagements policy, and a policy on `engagements` that reads a table whose
-- own policy reads `engagements` is infinite.
create or replace function public.engagement_has_assignee(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from engagement_assignees ea
     where ea.engagement_id = eid and ea.user_id = auth.uid()
  );
$$;

comment on function public.engagement_has_assignee(uuid) is
  'True when the caller is one of the people accountable for this engagement (1540). Separate from engagement_has_member: that one is access, this one is accountability, and an assignee implies access but never the reverse.';

-- ── seam 1: the ten child tables, via the helper they all already share ─────
-- Same shape as 1320. Teaching this ONE function about assignees opens exactly
-- the right ten doors and cannot open an eleventh by accident.
create or replace function public.engagement_is_private(eid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when public.engagement_has_member(eid) then false
    -- NEW: accountable for it => it is not private to you.
    when public.engagement_has_assignee(eid) then false
    else coalesce((
      select (c.is_private or e.is_private)
      from public.engagements e
      join public.clients c on c.id = e.client_id
      where e.id = eid and e.firm_id = public.current_firm_id()
    ), false)
  end
$$;

comment on function public.engagement_is_private(uuid) is
  'True if the engagement or its client is marked private AND the caller is neither explicitly on the engagement (1320) nor one of its assignees (1540). Security-definer; read by ten child-table policies, which is why both membership branches live here rather than in each of them.';

-- ── seam 2: the engagement itself ──────────────────────────────────────────
-- 1320's policy with ONE branch added. Every other arm is byte-identical.
drop policy if exists engagements_all on public.engagements;
create policy engagements_all on public.engagements for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.engagement_has_member(id)
      or public.engagement_has_assignee(id)
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
    -- UNCHANGED from 0850/0990/1220/1240/1320. Who may SEE a thing and who may
    -- mark it private are separate questions; this file answers only the first.
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and coalesce(is_private, false) = false
      )
    )
  );

-- ── seam 3: just enough of the client for the row to render ─────────────────
-- Without this an assigned engagement appears attributed to "—". Grants the
-- client ROW and nothing else, exactly as 1320 does for members.
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
  ) or exists (
    select 1
      from engagement_assignees ea
      join engagements e on e.id = ea.engagement_id
     where ea.user_id = auth.uid() and e.client_id = cid
  );
$$;

-- ── the table's own policy ─────────────────────────────────────────────────
-- Readable by anyone who can see the engagement, so "who else is on this?"
-- resolves. Writes go through the service-role client in the actions layer,
-- gated there, like every other roster write.
drop policy if exists engagement_assignees_select on engagement_assignees;
create policy engagement_assignees_select on engagement_assignees for select
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.engagement_has_assignee(engagement_id)
      or not public.engagement_is_private(engagement_id)
    )
  );

revoke all on engagement_assignees from anon, authenticated;
grant select on engagement_assignees to authenticated;

comment on table engagement_assignees is
  'Everyone accountable for one engagement (1540), INCLUDING the person named by engagements.assigned_user_id — that column stays as the primary/owner and is a pointer into this set. Readers union the two, so a pre-1540 row with no rows here still reads as its single assignee.';

-- Verify after applying:
--
--   -- 1. the table exists and is empty; every engagement still reads its
--   --    single primary, because readers union the column with this table:
--   select count(*) from engagement_assignees;                     --> 0
--
--   -- 2. put a SECOND person on a job that already has an assignee:
--   insert into engagement_assignees (engagement_id, user_id, firm_id)
--   values ('<engagement id>', '<their user id>', '<firm id>');
--
--   -- then, signed in as that second person:
--   select count(*) from engagements where id = '<that engagement id>';  --> 1
--   select count(*) from engagements where client_id = '<that client>';  --> 1
--          ^ ONE, not all of them. If this returns more, the client arm has
--            been widened by accident and being assigned one job leaks the
--            whole client. This is the boundary the feature is defined by.
--
--   -- 3. the primary is unchanged and still owns the job:
--   select assigned_user_id from engagements where id = '<that engagement id>';
--          ^ still the ORIGINAL person. Adding an assignee never moves it.
