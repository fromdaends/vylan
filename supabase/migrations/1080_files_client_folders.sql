-- FILES SECTION — the client-folder landing query.
--
-- The Files browser opens on a list of clients-as-folders: name, type, how many
-- documents, when the most recent one arrived, sorted by most recent activity.
--
-- Every one of those is an AGGREGATE, and this project has PostgREST's
-- aggregate functions disabled ("Use of aggregate functions is not allowed" —
-- Supabase's default, and a sensible one: they are a denial-of-service vector
-- on an open REST surface). So there is no way to ask for a grouped count over
-- the firm_documents view from the client.
--
-- The alternative was to pull every document row and group them in Node. That
-- is fine at today's 167 documents and indefensible at the "thousands per firm"
-- the feature is specified for — it would move megabytes over the wire on every
-- landing-page load, and "sorted by most recent activity" cannot be paginated
-- at all without the aggregate. One function is the honest fix, and it is far
-- cheaper to add now than to retrofit once the page is built on the wrong
-- shape.
--
-- SECURITY INVOKER (the default, stated here because it is load-bearing and a
-- future reader must not "tidy" it into DEFINER): the function body reads
-- firm_documents, which is itself security_invoker over RLS-protected base
-- tables. So a caller sees exactly the documents their own policies allow —
-- their firm only, private clients excluded unless they are the owner. Marking
-- this DEFINER would hand every firm's document counts to every user.
--
-- Additive + reversible. Down:
--   drop function if exists public.firm_document_folders(text, integer, integer);

create or replace function public.firm_document_folders(
  p_search text default null,
  p_limit integer default 60,
  p_offset integer default 0
)
returns table (
  client_id uuid,
  display_name text,
  client_type text,
  document_count bigint,
  last_activity timestamptz,
  -- Total number of matching folders, repeated on every row (count(*) over ()
  -- after GROUP BY counts the GROUPS). Saves a second round-trip purely to
  -- render "page 1 of 4".
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    c.display_name,
    c.type::text,
    count(d.id),
    max(d.created_at),
    count(*) over ()
  from public.clients c
  -- INNER join on purpose: Files lists folders that HAVE documents. A firm with
  -- 103 clients and documents for 20 of them should see 20 folders, not 83
  -- empty ones — this is a file browser, not the client list, and the Clients
  -- page is one click away for everything else.
  join public.firm_documents d
    on d.client_id = c.id
   and d.deleted_at is null
  where p_search is null
     or btrim(p_search) = ''
     or c.display_name ilike '%' || btrim(p_search) || '%'
  group by c.id, c.display_name, c.type
  order by max(d.created_at) desc nulls last, c.display_name asc
  -- Clamped in SQL, not in app code: this is a public RPC surface and an
  -- unbounded LIMIT handed in from a query string is the whole problem.
  limit greatest(0, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

revoke all on function public.firm_document_folders(text, integer, integer)
  from anon;
grant execute on function public.firm_document_folders(text, integer, integer)
  to authenticated;
