-- Firm-wide default automatic reminder schedule.
--
-- NULL means the firm has not created a preset yet. When present, the new
-- engagement builder copies this JSONB value into engagements.reminder_settings;
-- later edits or deletion of the firm preset therefore never change an
-- existing engagement's schedule.

alter table public.firms
  add column if not exists default_reminder_settings jsonb;

-- Owner-only at the application route. This column grant mirrors the other
-- authenticated firm preferences; row-level security still scopes the update
-- to the current firm.
grant update (default_reminder_settings)
  on public.firms to authenticated;

comment on column public.firms.default_reminder_settings is
  'Optional default automatic reminder schedule copied into each new engagement.';
