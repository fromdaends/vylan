-- Make the split-brain rejection state unrepresentable.
--
-- Whether a document is "rejected" lives in several columns, and different
-- surfaces read different ones: the accountant's AI badge reads ai_rejected,
-- the client portal reads review_status (via the item roll-up). Nothing forced
-- them to agree, so any write that touched one and forgot the other produced a
-- file that was rejected and not-rejected at the same time depending on where
-- you looked.
--
-- That is not hypothetical: the duplicate-promotion path did exactly this, and
-- 7 files were sitting in the contradiction in production (repaired before this
-- migration). The accountant was told "please upload an unaltered bank
-- statement" while the client's portal said "In review" and asked for nothing —
-- so the one action that would have unblocked the file was never requested.
--
-- The invariant, stated precisely:
--   ai_rejected = true  =>  review_status <> 'pending'
--
-- 'rejected' is the normal auto-reject outcome. 'approved' is ALSO legal and
-- deliberately allowed: that is the accountant using "AI was wrong" to override
-- a rejection, where ai_rejected stays true as an honest record of what the AI
-- concluded. Only 'pending' is impossible — it means the file is awaiting review
-- as though nothing happened, while a rejection is recorded against it.
--
-- NOT VALID + a separate VALIDATE keeps this safe on a live table: existing rows
-- are not scanned under an exclusive lock at deploy time, but every future
-- INSERT and UPDATE is checked immediately. The VALIDATE then confirms the
-- backfill was complete. If VALIDATE fails, rows still violate it — fix those
-- rather than dropping the constraint.

alter table uploaded_files
  drop constraint if exists uploaded_files_rejection_consistency;

alter table uploaded_files
  add constraint uploaded_files_rejection_consistency
  check (ai_rejected is not true or review_status <> 'pending')
  not valid;

alter table uploaded_files
  validate constraint uploaded_files_rejection_consistency;
