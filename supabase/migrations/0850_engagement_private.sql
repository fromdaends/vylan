-- 0850_engagement_private.sql
--
-- Team Wave 4 — per-ENGAGEMENT privacy, mirroring the client "Private to me".
--
-- 0810 already hid a private CLIENT's engagements from staff (cascade). This adds
-- an engagement's OWN is_private flag so an engagement can be private even on a
-- shared client, and — tied to the same firm "private by default" switch — new
-- engagements start private and existing ones backfill. Owner-only-settable;
-- hidden from staff, visible to all owners. Firm isolation unchanged.
--
-- The clean part: engagement_is_private() (0810, used by EVERY firm-only child
-- policy — file_comments, chat_*, final_documents, signature_requests,
-- payment_requests, activity_log, qbo_tx_suggestions) is updated to return true
-- when the engagement's client OR the engagement itself is private. So all those
-- children cascade for a privately-flagged engagement automatically — no child
-- policy needs editing. The EXISTS-join children (uploaded_files, request_items,
-- reminders, ai_rejection_overrides) cascade for free via engagements_all.

alter table public.engagements
  add column if not exists is_private boolean not null default false;

comment on column public.engagements.is_private is
  'Per-engagement "Private to me" (0850). When true the engagement + its children are hidden from STAFF, visible to all owners — independent of the client''s own is_private. Owner-only-settable (engagements_all WITH CHECK). New engagements default to this per the firm''s clients_private_by_default switch (owner-created); enabling that switch backfills existing engagements too.';

create index if not exists engagements_firm_private_idx
  on public.engagements (firm_id)
  where is_private = true;

-- Extend the shared cascade helper: private client OR private engagement.
create or replace function public.engagement_is_private(eid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select (c.is_private or e.is_private)
    from public.engagements e
    join public.clients c on c.id = e.client_id
    where e.id = eid and e.firm_id = public.current_firm_id()
  ), false)
$$;

-- Rewrite engagements_all: staff also can't see (or set) a privately-flagged
-- engagement. is_private is referenced as a DIRECT column (not the helper) so the
-- WITH CHECK arm evaluates the NEW row on INSERT/UPDATE, which is what makes the
-- flag owner-only-settable (a staff write leaving is_private=true fails the check).
drop policy if exists engagements_all on public.engagements;
create policy engagements_all on public.engagements for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and coalesce(is_private, false) = false
      )
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and coalesce(is_private, false) = false
      )
    )
  );
