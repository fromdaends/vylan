-- CLIENT RELATIONSHIPS — the entity tree (v1).
--
-- Links two EXISTING clients of the same firm with a typed relationship:
--   owner_of           individual → business, with an ownership percentage
--   spouse_of          individual ↔ individual (ONE row per couple, stored
--                      canonically with the lower uuid in from_client_id and
--                      rendered from both sides)
--   authorized_contact individual → business, with a scope list
--
-- Relationships are FIRM-INTERNAL metadata over existing clients. They never
-- create clients, never touch engagement/document/portal data, and are never
-- readable from the portal (no portal route queries this table; RLS scopes it
-- to firm members).
--
-- Manual only, by design: rows are written exclusively by firm users through
-- the server actions. There is NO AI involvement anywhere in this feature.
--
-- Soft delete: deleted_at + deleted_via, restored by clearing both.
--   'manual'          — the firm removed the link (kebab → Remove; undo toast)
--   'client_archived' — the archive-cascade trigger below hid it because one
--                       endpoint was archived; restoring that client restores
--                       exactly these rows (never the manually removed ones).

create table if not exists client_relationships (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- owner_of / authorized_contact: from = the individual, to = the business.
  -- spouse_of: canonical order, from < to (enforced below) so one couple can
  -- only ever be one row and the pair unique index has one shape to check.
  from_client_id uuid not null references clients(id) on delete cascade,
  to_client_id uuid not null references clients(id) on delete cascade,
  rel_type text not null
    check (rel_type in ('owner_of', 'spouse_of', 'authorized_contact')),
  percentage integer,
  scopes text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_via text check (deleted_via in ('manual', 'client_archived')),
  constraint client_relationships_no_self
    check (from_client_id <> to_client_id),
  -- Type-specific field shape. Every term is null-proofed explicitly: a CHECK
  -- that evaluates to NULL passes, so "percentage between 1 and 100" alone
  -- would wave a NULL percentage through on an owner_of row.
  constraint client_relationships_type_fields check (
    (
      rel_type = 'owner_of'
      and percentage is not null
      and percentage between 1 and 100
      and scopes is null
    )
    or (rel_type = 'spouse_of' and percentage is null and scopes is null)
    or (
      rel_type = 'authorized_contact'
      and percentage is null
      and scopes is not null
      and coalesce(array_length(scopes, 1), 0) >= 1
      and scopes <@ array['all', 'payroll', 'corporate_tax', 'bookkeeping', 'gst_qst']::text[]
    )
  ),
  constraint client_relationships_spouse_canonical
    check (rel_type <> 'spouse_of' or from_client_id < to_client_id),
  -- deleted_at and deleted_via travel together, both set or both null.
  constraint client_relationships_deleted_shape
    check ((deleted_at is null) = (deleted_via is null))
);

-- No duplicate identical LIVE links. Soft-deleted rows fall out, so a removed
-- link can be re-created (or restored) without colliding with its own ghost.
create unique index if not exists client_relationships_live_pair_idx
  on client_relationships (firm_id, rel_type, from_client_id, to_client_id)
  where deleted_at is null;

-- Profile reads look the client up from either end.
create index if not exists client_relationships_from_idx
  on client_relationships (from_client_id) where deleted_at is null;
create index if not exists client_relationships_to_idx
  on client_relationships (to_client_id) where deleted_at is null;
-- Clients-list indicator reads the firm's live links in one query.
create index if not exists client_relationships_firm_idx
  on client_relationships (firm_id) where deleted_at is null;

-- ── Integrity guard ──────────────────────────────────────────────────────────
-- The rules the CHECKs can't express: both endpoints in the row's firm, the
-- endpoint client TYPES matching the relationship type, and max one live
-- spouse link per individual. SECURITY DEFINER + explicit firm scoping (the
-- 0810/1090 helper pattern): the spouse count must see rows involving PRIVATE
-- clients that the acting staff user can't, otherwise a second spouse link
-- could slip in past RLS.
create or replace function public.client_relationships_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from clients%rowtype;
  v_to clients%rowtype;
  v_spouse_count integer;
begin
  select * into v_from from clients where id = new.from_client_id;
  select * into v_to from clients where id = new.to_client_id;
  if v_from.id is null or v_to.id is null
     or v_from.firm_id <> new.firm_id or v_to.firm_id <> new.firm_id then
    raise exception 'client_relationships: both ends must be clients of the same firm';
  end if;
  if new.rel_type in ('owner_of', 'authorized_contact') then
    if v_from.type <> 'individual' or v_to.type <> 'business' then
      raise exception 'client_relationships: % links an individual to a business',
        new.rel_type;
    end if;
  else
    if v_from.type <> 'individual' or v_to.type <> 'individual' then
      raise exception 'client_relationships: spouse_of links two individuals';
    end if;
    if new.deleted_at is null then
      select count(*) into v_spouse_count
        from client_relationships
       where firm_id = new.firm_id
         and rel_type = 'spouse_of'
         and deleted_at is null
         and id is distinct from new.id
         and (from_client_id in (new.from_client_id, new.to_client_id)
              or to_client_id in (new.from_client_id, new.to_client_id));
      if v_spouse_count > 0 then
        raise exception 'client_relationships: max one spouse link per individual';
      end if;
    end if;
  end if;
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists client_relationships_guard_trg on client_relationships;
create trigger client_relationships_guard_trg
  before insert or update on client_relationships
  for each row execute function public.client_relationships_guard();

-- ── Archive cascade ──────────────────────────────────────────────────────────
-- Archiving a client soft-deletes its live relationships; restoring the client
-- restores ONLY the rows that the archive hid (deleted_via = 'client_archived'),
-- never links someone removed by hand. In the database rather than the action,
-- so every archive path — today's and any future one — keeps the invariant.
create or replace function public.client_relationships_archive_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update client_relationships
       set deleted_at = now(), deleted_via = 'client_archived'
     where deleted_at is null
       and (from_client_id = new.id or to_client_id = new.id);
  elsif new.archived_at is null and old.archived_at is not null then
    update client_relationships
       set deleted_at = null, deleted_via = null
     where deleted_via = 'client_archived'
       and (from_client_id = new.id or to_client_id = new.id);
  end if;
  return new;
end
$$;

drop trigger if exists client_relationships_archive_cascade_trg on clients;
create trigger client_relationships_archive_cascade_trg
  after update of archived_at on clients
  for each row execute function public.client_relationships_archive_cascade();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Firm isolation plus the private-client cascade on BOTH ends: if either
-- endpoint is a private client, staff neither see nor write the link (owners
-- always can) — same posture as 1140. Soft-deleted rows stay VISIBLE to the
-- firm (unlike 1090's documents): they're firm-internal metadata needed for
-- undo/restore, and no portal surface reads this table at all.
alter table client_relationships enable row level security;

drop policy if exists client_relationships_all on client_relationships;
create policy client_relationships_all on client_relationships for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(from_client_id)
        and not public.client_is_private(to_client_id)
      )
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(from_client_id)
        and not public.client_is_private(to_client_id)
      )
    )
  );

revoke all on client_relationships from anon, authenticated;
-- No DELETE grant: removal is a soft delete (UPDATE). Hard deletes only via
-- the clients FK cascade when a client row itself is ever purged.
grant select, insert, update on client_relationships to authenticated;

-- Down: drop triggers client_relationships_guard_trg (on client_relationships)
-- and client_relationships_archive_cascade_trg (on clients), drop both
-- functions, drop table client_relationships.
