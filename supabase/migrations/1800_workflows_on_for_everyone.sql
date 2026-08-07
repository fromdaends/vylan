-- Workflows (flows/automations) go live for EVERY firm.
--
-- firms.workflows_enabled shipped default-false in 1560 as the staged-rollout
-- safety switch; only the founder's firm ran the engine while the feature set
-- was built out (engine, library, letters at send, board, timeline, reminders
-- in flows, AI drafting). The founder, 2026-08-07, on other firms not seeing
-- any of it: turn it on for everyone.
--
-- Existing engagements are untouched: they carry no workflow snapshot, so the
-- engine reads them as legacy and no behaviour changes retroactively. Only
-- engagements CREATED after a firm is switched on run flows.
--
-- Idempotent throughout. Reversible per firm by setting the column false.

alter table public.firms alter column workflows_enabled set default true;

update public.firms set workflows_enabled = true where workflows_enabled = false;

comment on column public.firms.workflows_enabled is
  'Engagement workflows (automations library + stage engine effects + AI drafting). Default ON since 1800; false is a per-firm opt-out that restores pre-1560 behaviour.';
