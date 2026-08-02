-- DOCUMENT TEXT + FULL-TEXT SEARCH (Files v2 §5).
--
-- The Phase 0 audit's finding: Vylan never stored document text — the intake
-- reader returns structure (type, dates, amounts), not a transcript. This
-- table is where transcripts now land, and the founder's rulings shape it:
--
--   * Text is captured ONLY at client-portal intake, as part of the reader's
--     one existing call. No bulk re-reads, no backfill over old documents
--     (they stay searchable by name and details), and imported documents are
--     never sent to any model — so rows appear here only as new portal
--     uploads arrive.
--   * Bilingual by construction: the tsvector indexes the text through BOTH
--     the english and french configurations, unaccented, so "Relevé" matches
--     "releve" and English stemming works beside French stemming.

create extension if not exists unaccent;

-- Generated columns require IMMUTABLE expressions and unaccent() is only
-- STABLE (its dictionary is looked up at call time). The standard wrapper
-- pins the dictionary explicitly and declares immutability — sound because
-- the unaccent rules file does not change under a running database.
create or replace function public.immutable_unaccent(text)
returns text
language sql immutable parallel safe strict
as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

create table if not exists document_texts (
  source text not null check (source in ('checklist', 'final', 'imported')),
  document_id uuid not null,
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- Capped by the writer at 20k chars; left() here is belt-and-suspenders so
  -- the index cost stays bounded no matter who writes.
  extracted_text text not null,
  tsv tsvector generated always as (
    to_tsvector('english', public.immutable_unaccent(left(extracted_text, 20000)))
    || to_tsvector('french', public.immutable_unaccent(left(extracted_text, 20000)))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, document_id)
);

create index if not exists document_texts_tsv_idx
  on document_texts using gin (tsv);
create index if not exists document_texts_firm_idx
  on document_texts (firm_id);

-- Firm members read (same firm-isolation + private-client cascade as every
-- document table); ONLY the intake worker writes, via the service role.
alter table document_texts enable row level security;
drop policy if exists document_texts_select on document_texts;
create policy document_texts_select on document_texts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );
revoke all on document_texts from anon, authenticated;
grant select on document_texts to authenticated;

-- Content search with a highlighted snippet, one call. SECURITY INVOKER is
-- load-bearing twice over: the RLS above scopes rows to the caller's firm,
-- and the EXISTS against firm_documents (itself security_invoker) re-applies
-- every document rule — a soft-deleted file can never surface here, exactly
-- as the spec requires.
create or replace function public.search_document_texts(
  p_query text,
  p_limit int default 40
) returns table (
  source text,
  document_id uuid,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', public.immutable_unaccent(p_query))
        || websearch_to_tsquery('french',  public.immutable_unaccent(p_query)) as tsq
  )
  select
    dt.source,
    dt.document_id,
    ts_headline(
      'simple',
      left(dt.extracted_text, 20000),
      q.tsq,
      'MaxWords=18, MinWords=8, MaxFragments=1'
    ) as snippet,
    ts_rank(dt.tsv, q.tsq) as rank
  from document_texts dt, q
  where dt.tsv @@ q.tsq
    and exists (
      select 1 from public.firm_documents fd
      where fd.source = dt.source
        and fd.id = dt.document_id
        and fd.deleted_at is null
    )
  order by rank desc
  limit greatest(1, least(coalesce(p_limit, 40), 100));
$$;

revoke all on function public.search_document_texts(text, int) from public, anon;
grant execute on function public.search_document_texts(text, int) to authenticated;
