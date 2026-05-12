-- Relai — reminders.
--
-- Adds engagements.reminders_paused so the accountant can stop the
-- automated nudges without cancelling the engagement.
--
-- (The jobs queue itself was already created in 0001_init.sql.)

alter table engagements
  add column if not exists reminders_paused boolean not null default false;
