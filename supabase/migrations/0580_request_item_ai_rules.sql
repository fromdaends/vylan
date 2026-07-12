-- Per-checklist-item custom rules for the AI document checker (phase 4).
--
-- Each request_item gets an optional free-text `ai_rules`: the accountant's
-- firm-specific instructions for what a good upload against THIS item looks
-- like (e.g. "must show tax year 2025 and the client's SIN", "reject if the
-- total is blurred"). When a client uploads a document for the item, the
-- checker prompt includes these rules so the accept / reject / flag verdict
-- reflects them.
--
-- request_items is NOT under the per-column UPDATE lockdown (0039 only locked
-- users + firms), so the accountant's own RLS-scoped session can write this
-- column with no extra grant, exactly like label / doc_type / required.
--
-- Additive + reversible (down: drop column). Gated: readers treat a missing
-- column as "no custom rules", so the checker behaves exactly as today until
-- the SQL is applied.

alter table request_items
  add column if not exists ai_rules text;
