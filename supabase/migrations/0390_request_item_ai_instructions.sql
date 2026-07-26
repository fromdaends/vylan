-- Per-item AI instructions (optional). Free-text guidance the accountant types
-- on a checklist item to steer the AI's assessment of the client's upload for
-- THAT item (e.g. "expect a 2024 return, not 2026"). NULL/blank = today's
-- default behavior. Read by the per-file classifier (ai/process + ai/classify)
-- and the set-assessment worker, and injected into their model prompts.
--
-- Additive + reversible (down: drop the column). Inherits the existing
-- request_items_all RLS policy (0002_rls.sql) — no policy/grant change needed;
-- request_items is not in the 0039 column-update whitelist (that locks only
-- users/firms).
alter table request_items
  add column if not exists ai_instructions text;
