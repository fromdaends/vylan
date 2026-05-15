-- Phase 5: scrub PII from existing activity_log rows.
--
-- Two metadata keys carried client-identifying information across the
-- 2-year audit-log retention:
--
--   1. `client_uploaded.metadata.filename` — frequently contained client
--      names (e.g. "Jean_Tremblay_T4_2024.pdf"). New writes from the
--      portal upload route now persist `file_id` instead; the timeline
--      UI looks up the live filename from `uploaded_files` at render
--      time, so PII only lives as long as the file does.
--
--   2. `reject_item.metadata.reason` — the rejection reason was duplicated
--      from `request_items.rejection_reason`. The reason can legitimately
--      contain client-specific phrasing an accountant typed; we keep the
--      authoritative copy on the row (where the accountant can edit/
--      clear it) and stop duplicating it into the long-term log.
--
-- For old rows we cannot reconstruct `file_id` or recover any other
-- non-PII signal. Dropping the keys is the right tradeoff: the timeline
-- will show "—" for these historical entries, and that's exactly the
-- intended privacy contract.
--
-- The `?` operator tests JSONB key existence, and `metadata - 'key'`
-- returns the JSONB with that key removed. Both are atomic.

update activity_log
set metadata = metadata - 'filename'
where action = 'client_uploaded'
  and metadata ? 'filename';

update activity_log
set metadata = metadata - 'reason'
where action = 'reject_item'
  and metadata ? 'reason';
