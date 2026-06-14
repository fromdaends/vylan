-- Per-engagement "AI Analyze" toggle. When OFF, NO document uploaded to this
-- engagement is ever sent to the (paid) AI — both the per-file classification
-- (src/lib/ai/process.ts) and the set-level assessment (src/lib/ai/set-assessment.ts)
-- are gated at the ENGINE level, so a firm can disable AI on a case-by-case
-- basis to control AI usage / cost. The accountant chooses this at creation via
-- the "AI Analyze" switch on the engagement builder.
--
-- Defaults TRUE so every existing engagement keeps its current AI behaviour and
-- new engagements stay AI-on unless the accountant unchecks the switch.
-- Additive + reversible (down: drop the column).
--
-- No extra grant needed: engagements has no column-level write whitelist (unlike
-- firms, 0039). The accountant sets it through the RLS-scoped session client's
-- INSERT; the AI workers read it through the service-role client (RLS-bypassing).
-- The engine read is best-effort and defaults to ON, so the gates are safe to
-- deploy before this migration is applied to a given environment.
alter table engagements
  add column if not exists ai_enabled boolean not null default true;
