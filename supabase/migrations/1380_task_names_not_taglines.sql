-- Give the backfilled tasks a NAME instead of a category.
--
-- The founder, looking at twenty-eight rows on the Tasks page all reading
-- "Document collection":
--
--   "the tag 'document colletion' is too broad and not an actual accouting
--    term... every task should have an ctual name not just a broad tagline"
--
-- Correct, and 1370 caused it. Its backfill set every task's title to the name
-- of its KIND, which is a category — so the one column that was supposed to
-- tell twenty-eight rows apart said the same word on all of them, and the only
-- thing distinguishing them was the small grey line underneath.
--
-- The kind is a TAG on the row now, drawn from the kind column. That frees the
-- title to be what it always should have been: whatever the accountant calls
-- this piece of work.
--
-- ── WHAT THIS RENAMES TO, AND WHY IT IS NOT INVENTED ───────────────────────
--
-- The engagement's own title. "T2 Tax Return" for ABC Incorporation, "T1 —
-- Particulier — 2026" for Mathieu Lévesque. Not a phrase I made up about their
-- practice: it is the name the founder already gave that job, so the row reads
-- as the thing it belongs to rather than as its category.
--
-- It is a starting point, not the final answer. Every one of these is editable,
-- and new tasks are named by the person creating them — the dialog's name field
-- now starts EMPTY on every kind, because a pre-filled field is a suggestion
-- that the question is already answered, which is exactly how this happened.
--
-- ── ONLY THE ONES NOBODY HAS TOUCHED ───────────────────────────────────────
--
-- Matched on the exact strings 1370 wrote and nothing else. A task somebody has
-- already renamed keeps its name; so does one whose title merely CONTAINS the
-- words. If this runs twice the second pass matches nothing, because the titles
-- are no longer the category.
--
-- ⚠️ A NOTE FOR THE NEXT MIGRATION IN THIS TABLE. 1370 aborted on its first
-- insert because a CASE resolves to TEXT and `status` is an enum, which no
-- test, build or preview in this repo can catch — SQL here is only ever
-- executed when it is applied. This file writes no enum values at all, which is
-- deliberate: it is a rename and nothing more.

update public.engagement_tasks t
   set title = e.title
  from public.engagements e
 where t.engagement_id = e.id
   and t.kind = 'document_collection'
   and t.title = 'Document collection'
   and coalesce(btrim(e.title), '') <> '';

update public.engagement_tasks t
   set title = e.title || ' — ' || 'Signatures'
  from public.engagements e
 where t.engagement_id = e.id
   and t.kind = 'signatures'
   and t.title = 'Signatures'
   and coalesce(btrim(e.title), '') <> '';

update public.engagement_tasks t
   set title = e.title || ' — ' || 'Deliverables'
  from public.engagements e
 where t.engagement_id = e.id
   and t.kind = 'deliverables'
   and t.title = 'Deliverables'
   and coalesce(btrim(e.title), '') <> '';

-- Verify after applying:
--
--   -- Nothing should be left carrying a bare category as its whole name:
--   select count(*) from engagement_tasks
--    where title in ('Document collection', 'Signatures', 'Deliverables');
--   --> 0, EXCEPT for any task on an engagement with a blank title, which is
--       skipped on purpose: renaming it to '' would be worse than the category.
--
--   -- And the count is unchanged — this renames, it never inserts or deletes:
--   select count(*) from engagement_tasks;   --> same as before
