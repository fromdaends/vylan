-- Remove the per-checklist-item custom AI rules feature (added in 0580).
--
-- The feature was dropped: the document checker already reads each item's label
-- on its own (including a year, e.g. "Bank statement 2022") and already rejects
-- blurry / cropped / redacted uploads, so per-item rules added nothing. All the
-- code that read or wrote request_items.ai_rules has been removed.
--
-- This drops the now-unused column. Optional cleanup: the app works whether or
-- not it runs (no code references the column anymore), so it can be applied
-- whenever convenient. 0580 is intentionally left in place (migrations are
-- never deleted); this is the forward "down".
--
-- The column holds no meaningful data (the feature shipped and was reverted the
-- same day), so the drop is safe. Reversible: re-add with `add column ai_rules
-- text` if ever needed.

alter table request_items
  drop column if exists ai_rules;
