-- Set-aware document analysis, Phase 1 (plumbing): persist the AI's ITEM-LEVEL
-- "set assessment" — one judgment about ALL of an item's (non-duplicate) files
-- judged TOGETHER (completeness conclusion EN+FR, confidence, a per-file page
-- map, flags), written by the assess_item_set job worker. Today every file is
-- classified ALONE, so a 4-photo statement is four blind per-page verdicts;
-- this column is where the set-level verdict lands. Additive + reversible
-- (down: drop the column and the index); no existing row is touched.
--
-- The stored document:
--   { conclusion_en, conclusion_fr, confidence,
--     pages: [{ file_id, position, of_total,
--               placement: 'printed'|'inferred'|'unconfirmed', note }],
--     flags: [string],
--     assessed_at: ISO timestamp,
--     files_signature: ["<file_id>:<content_hash>", ...] (sorted) }
-- files_signature lists the files the assessment actually covered, so readers
-- can tell when later uploads/deletes have made it stale.
alter table request_items
  add column if not exists ai_set_assessment jsonb;

-- Written ONLY by the service-role job worker; members read it through the
-- existing request_items SELECT grant. No new column grant is needed — the
-- 0039 column whitelist constrains member UPDATEs, and members never update
-- this column.

-- Debounce dedupe: at most ONE pending set-assessment job per item. Concurrent
-- uploads in a burst then converge on pushing the single pending job's
-- run_after back (one AI call per burst) instead of stacking duplicate jobs,
-- each of which would bill its own AI call. Partial: 'running'/'done'/'failed'
-- rows never block scheduling the next assessment.
create unique index if not exists jobs_pending_set_assessment_uniq
  on jobs ((payload->>'request_item_id'))
  where kind = 'assess_item_set' and status = 'pending';
