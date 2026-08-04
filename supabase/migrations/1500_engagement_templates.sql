-- ENGAGEMENT TEMPLATES — a whole engagement, saved and reused.
--
-- The founder, on what Vylan was missing: "there's templates for the entire
-- engagement, which have subtemplates inside of it. So it's the act of saving
-- an entire kind of engagement... when you create an engagement, engagement
-- details, there's client and then there's template. Those templates being
-- shown are purely for document collection."
--
-- Exactly right. `templates` (migration 0001) holds a list of DOCUMENT REQUESTS
-- and nothing else — no scope, no price, no billing, no reminders. Picking one
-- gives you a checklist. This is the other thing: everything the builder
-- captures, minus the client.
--
-- WHY jsonb AND NOT COLUMNS. An engagement template is a SNAPSHOT OF BUILDER
-- STATE, and the builder is still growing — Terms and Tasks are still to come,
-- and each would otherwise be another migration and another backfill here. The
-- existing `templates` table already stores its items this way, so this is the
-- repo's own precedent rather than a new idea. The trade is real: nothing in
-- the database validates the payload, so the READER must treat every field as
-- optional and unknown-shaped. It does.
--
-- WHAT IT DELIBERATELY DOES NOT STORE: the client. A template is a kind of
-- work, not a kind of work for one person — Canopy's engagement templates
-- carry no client either, and it is supplied when the engagement is created.

create table if not exists public.engagement_templates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,

  name text not null,

  -- Canopy's "Template Access", which the founder saw grouped in their own
  -- dropdown as an ungrouped list plus a "Private" section:
  --   team    — everyone in the firm can use it
  --   private — only the person who made it
  -- Enforced in RLS below, not merely in the UI.
  access text not null default 'team'
    check (access in ('team', 'private')),

  -- The builder's state, minus the client. Read defensively: every field is
  -- optional, because a template saved today will be read by a builder that has
  -- grown new steps.
  payload jsonb not null default '{}'::jsonb,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id) on delete set null
);

create index if not exists engagement_templates_firm_idx
  on public.engagement_templates (firm_id, created_at desc);
-- Pickers only ever ask for the live ones.
create index if not exists engagement_templates_live_idx
  on public.engagement_templates (firm_id) where archived_at is null;

alter table public.engagement_templates enable row level security;

do $$
begin
  -- SELECT carries the private rule. A private template is invisible to the
  -- rest of the firm at the DATABASE, not just hidden in a dropdown — otherwise
  -- "private" is a label rather than a guarantee.
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'engagement_templates'
      and policyname = 'engagement_templates_select'
  ) then
    create policy engagement_templates_select on public.engagement_templates
      for select using (
        firm_id in (select firm_id from public.users where id = auth.uid())
        and (access = 'team' or created_by_user_id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'engagement_templates'
      and policyname = 'engagement_templates_insert'
  ) then
    create policy engagement_templates_insert on public.engagement_templates
      for insert with check (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  -- Canopy's rule for engagement templates is that TEAM access means everyone
  -- can use OR EDIT, so editing is not restricted to the creator. A private one
  -- is still only its owner's.
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'engagement_templates'
      and policyname = 'engagement_templates_update'
  ) then
    create policy engagement_templates_update on public.engagement_templates
      for update using (
        firm_id in (select firm_id from public.users where id = auth.uid())
        and (access = 'team' or created_by_user_id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'engagement_templates'
      and policyname = 'engagement_templates_delete'
  ) then
    create policy engagement_templates_delete on public.engagement_templates
      for delete using (
        firm_id in (select firm_id from public.users where id = auth.uid())
        and (access = 'team' or created_by_user_id = auth.uid())
      );
  end if;
end $$;

comment on table public.engagement_templates is
  'A whole engagement saved for reuse — scope, documents, billing, reminders — minus the client. Distinct from `templates`, which holds document requests only. Payload is jsonb because it snapshots builder state and the builder is still growing.';
comment on column public.engagement_templates.access is
  'team = the whole firm may use and edit it; private = its creator only. Enforced in RLS, not just the UI.';
