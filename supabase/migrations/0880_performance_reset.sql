-- 0880_performance_reset.sql
--
-- Per-firm "Reset stats" baseline for the Performance page.
--
-- When set, the Performance page counts only records dated ON OR AFTER this
-- instant — a non-destructive clean slate. NOTHING is deleted: invoices,
-- documents, AI verdicts and activity all stay exactly as they were and keep
-- working everywhere else in the app. Clearing the column (back to NULL) brings
-- the full history straight back, so the whole thing is reversible.
--
-- Owner-set via a service-role server action (like team_enabled /
-- clients_private_by_default), so NO column-level UPDATE grant is needed here.
-- NULL (the default) = no reset, show the firm's full history.
--
-- Only the range-scoped historical stats honour this baseline (collected,
-- documents received, per-month average, AI accuracy, automation counts, the
-- charts and the top-clients rankings). The two LIVE snapshots — Outstanding
-- and Pending review — deliberately ignore it: they reflect money still owed and
-- documents still awaiting review right now, and hiding those would be
-- misleading, not a "clean slate".

alter table public.firms
  add column if not exists performance_reset_at timestamptz;

comment on column public.firms.performance_reset_at is
  'Performance page "reset stats" baseline: when set, the page counts only records on/after this instant (range-scoped stats only; live Outstanding/Pending review ignore it). NULL = show all history. Non-destructive and reversible; owner-set via a service-role action.';
