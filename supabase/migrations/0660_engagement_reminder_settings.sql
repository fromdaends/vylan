-- Per-engagement automatic reminder cadence and email copy.
-- Jobs keep a snapshot of the relevant step, while this JSONB value lets a
-- draft preserve its reminder choices until it is eventually sent.

alter table public.engagements
  add column if not exists reminder_settings jsonb not null default
  '{
    "enabled": true,
    "steps": [
      {"tone":"gentle","enabled":true,"timing":"after_send","days":3,"withSms":false,"customSubject":null,"customMessage":null},
      {"tone":"firm","enabled":true,"timing":"after_send","days":7,"withSms":true,"customSubject":null,"customMessage":null},
      {"tone":"deadline","enabled":true,"timing":"after_send","days":14,"withSms":true,"customSubject":null,"customMessage":null},
      {"tone":"overdue","enabled":true,"timing":"after_due","days":1,"withSms":false,"customSubject":null,"customMessage":null}
    ]
  }'::jsonb;

comment on column public.engagements.reminder_settings is
  'Automatic reminder enablement, timing, and optional custom email copy for this engagement.';
