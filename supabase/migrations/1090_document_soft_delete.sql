-- FILES — soft delete, enforced in the DATABASE rather than in 40 call sites.
--
-- 1070 added deleted_at to uploaded_files / final_documents / imported_documents.
-- Nothing reads it yet. Making it mean something requires every reader in the
-- product to exclude deleted rows: the client portal, the engagement page, the
-- archive ZIP, the firm export, the AI set-assessment, the dashboard worklist,
-- the filing engine, the Sage export, the QuickBooks draft backfill… ~40 query
-- sites across 30+ files today, and every new one written from here on.
--
-- Patching them one by one was rejected. The failure mode is not "the sweep is
-- tedious", it is "the sweep misses one and a client still sees a document the
-- firm deleted" — and the miss is silent. Worse, it re-opens every time someone
-- adds a query, forever.
--
-- So the exclusion moves into the RLS policies. After this migration a deleted
-- document is simply NOT VISIBLE to any normal read, and every existing call
-- site is fixed at once without being touched. New call sites are safe by
-- default, which is the only property that survives contact with a growing
-- codebase.
--
-- ── The three consequences, all deliberate ─────────────────────────────────
--
-- 1. USING gets the filter; WITH CHECK does NOT. USING decides which rows you
--    can see and act on (the OLD row); WITH CHECK validates the row you are
--    writing (the NEW row). Putting `deleted_at is null` in WITH CHECK would
--    make the soft delete itself illegal — you would be writing a row the
--    policy forbids. With it only in USING, deleting works (old row visible,
--    new row unconstrained) and the row then vanishes.
--
-- 2. RESTORE cannot go through RLS, precisely because the row is now invisible.
--    That is why restore_document() below is SECURITY DEFINER. This is a
--    feature, not a workaround: un-deleting is a privileged act and now has
--    exactly one implementation to audit instead of being an ordinary UPDATE
--    anybody could issue.
--
-- 3. The RECYCLE BIN needs to see what everyone else cannot, hence
--    firm_deleted_documents(). Also SECURITY DEFINER, and — like 0810's
--    helpers — self-scoped to current_firm_id() inside the body, which reads
--    the caller's JWT and is unaffected by the definer context. It re-applies
--    the private-client rule itself rather than trusting the caller.
--
-- SERVICE-ROLE READERS ARE NOT COVERED. The service role bypasses RLS by
-- design, so the crons, the filing runner, the archive builder and the portal
-- routes still see deleted rows and are patched in code alongside this
-- migration. That set is small and enumerable; the RLS-client set was not.
--
-- Additive + reversible. Down: restore the three policies to their previous
-- definitions (they are reproduced verbatim below, minus the new term) and
-- drop the two functions.

-- ── 1. uploaded_files ──────────────────────────────────────────────────────
-- Base policy from 0002: gate through an EXISTS join to the parent engagement,
-- which is what makes this table inherit 0810 (private clients), 0850 (private
-- engagements) and 0990 (assigned staff) for free. That join is reproduced
-- EXACTLY; the only change is the appended deleted_at term.
drop policy if exists uploaded_files_all on public.uploaded_files;
create policy uploaded_files_all on public.uploaded_files for all
  using (
    deleted_at is null
    and exists (
      select 1 from public.engagements e
      where e.id = uploaded_files.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1 from public.engagements e
      where e.id = uploaded_files.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  );

-- ── 2. final_documents ─────────────────────────────────────────────────────
-- Base policy from 0810: firm scope plus the engagement_is_private() gate that
-- 0990 deliberately did NOT relax, so deliverables on a private engagement stay
-- owner-only. Reproduced exactly, plus the deleted_at term.
drop policy if exists final_documents_all on public.final_documents;
create policy final_documents_all on public.final_documents for all
  using (
    deleted_at is null
    and firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.engagement_is_private(engagement_id)
    )
  )
  with check (firm_id = public.current_firm_id());

-- ── 3. imported_documents ──────────────────────────────────────────────────
-- Base policy from 1070 (the clients_all shape), plus the deleted_at term.
drop policy if exists imported_documents_all on public.imported_documents;
create policy imported_documents_all on public.imported_documents for all
  using (
    deleted_at is null
    and firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  );

-- ── 4. The recycle bin ─────────────────────────────────────────────────────
-- Deleted documents within the retention window, for the firm of whoever is
-- asking. SECURITY DEFINER because the policies above have just made these rows
-- invisible to everyone; self-scoped to current_firm_id() so being definer
-- cannot cross a firm boundary, and it re-applies the same private-client /
-- private-engagement rules the normal policies would have.
--
-- Rows OLDER than the window are excluded even though they still exist: they
-- are awaiting the purge cron, and offering "restore" on something that is
-- about to be erased would be a lie. Same rule the engagements Recently-deleted
-- view uses (0139 / lib/engagements/lifecycle.ts).
create or replace function public.firm_deleted_documents(
  p_retention_days integer default 30,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  source text,
  id uuid,
  client_id uuid,
  client_name text,
  name text,
  mime_type text,
  size_bytes bigint,
  deleted_at timestamptz,
  deleted_by_user_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with cutoff as (
    select now() - make_interval(days => greatest(1, least(coalesce(p_retention_days, 30), 365))) as t
  )
  select 'checklist'::text, uf.id, e.client_id, c.display_name,
         coalesce(nullif(btrim(uf.display_name), ''), uf.original_filename),
         uf.mime_type, uf.size_bytes, uf.deleted_at, uf.deleted_by_user_id
  from public.uploaded_files uf
  join public.engagements e on e.id = uf.engagement_id
  join public.clients c on c.id = e.client_id
  cross join cutoff
  where uf.deleted_at is not null
    and uf.deleted_at >= cutoff.t
    and e.firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(e.client_id))

  union all

  select 'final'::text, fd.id, e.client_id, c.display_name,
         coalesce(nullif(btrim(fd.display_name), ''), fd.original_filename),
         fd.mime_type, fd.size_bytes, fd.deleted_at, fd.deleted_by_user_id
  from public.final_documents fd
  join public.engagements e on e.id = fd.engagement_id
  join public.clients c on c.id = e.client_id
  cross join cutoff
  where fd.deleted_at is not null
    and fd.deleted_at >= cutoff.t
    and fd.firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(fd.engagement_id))

  union all

  select 'imported'::text, im.id, im.client_id, c.display_name,
         coalesce(nullif(btrim(im.display_name), ''), im.original_filename),
         im.mime_type, im.size_bytes, im.deleted_at, im.deleted_by_user_id
  from public.imported_documents im
  join public.clients c on c.id = im.client_id
  cross join cutoff
  where im.deleted_at is not null
    and im.deleted_at >= cutoff.t
    and im.firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(im.client_id))

  order by 8 desc
  limit greatest(0, least(coalesce(p_limit, 100), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

revoke all on function public.firm_deleted_documents(integer, integer, integer) from anon;
grant execute on function public.firm_deleted_documents(integer, integer, integer) to authenticated;

-- ── 5. Restore ─────────────────────────────────────────────────────────────
-- Un-delete one document. SECURITY DEFINER for the reason in the header: the
-- row is invisible to the caller's own policies by construction, so this is the
-- single audited way back. Every arm re-proves firm ownership AND the same
-- privacy rule the normal policies apply, so definer buys reach, never
-- permission.
--
-- Returns true when a row was actually restored, so the caller can tell
-- "restored" from "not yours / already gone" without a second query — and
-- without an existence oracle.
create or replace function public.restore_document(
  p_source text,
  p_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  if p_source = 'checklist' then
    update public.uploaded_files uf
       set deleted_at = null, deleted_by_user_id = null
     where uf.id = p_id
       and uf.deleted_at is not null
       and exists (
         select 1 from public.engagements e
         where e.id = uf.engagement_id
           and e.firm_id = public.current_firm_id()
           and (public.current_user_is_owner() or not public.client_is_private(e.client_id))
       );
    get diagnostics n = row_count;

  elsif p_source = 'final' then
    update public.final_documents fd
       set deleted_at = null, deleted_by_user_id = null
     where fd.id = p_id
       and fd.deleted_at is not null
       and fd.firm_id = public.current_firm_id()
       and (public.current_user_is_owner() or not public.engagement_is_private(fd.engagement_id));
    get diagnostics n = row_count;

  elsif p_source = 'imported' then
    update public.imported_documents im
       set deleted_at = null, deleted_by_user_id = null
     where im.id = p_id
       and im.deleted_at is not null
       and im.firm_id = public.current_firm_id()
       and (public.current_user_is_owner() or not public.client_is_private(im.client_id));
    get diagnostics n = row_count;

  else
    return false;
  end if;

  return n > 0;
end;
$$;

revoke all on function public.restore_document(text, uuid) from anon;
grant execute on function public.restore_document(text, uuid) to authenticated;
