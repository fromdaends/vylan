-- WHO LAST TOUCHED A TEMPLATE, AND WHEN.
--
-- Canopy's template lists put one line under every name: "Template last edited
-- on 10/16/2025 by me". The founder sent that screenshot and asked for it.
--
-- Vylan's three template tables all record created_at and nothing else, so a
-- template edited eight times still reported the day it was born — which is the
-- least useful of the two dates on a list you keep coming back to.
--
-- WHY A TRIGGER RATHER THAN TRUSTING THE WRITER. There are already several
-- write paths per table (the editor, the save-back from a builder, a clone) and
-- more coming. Every one of them would have to remember to set updated_at, and
-- the day one forgets, a row quietly claims it has not changed since last year.
-- The database is the only place that can know for certain.
--
-- updated_by_user_id is NOT triggered, because the database cannot tell WHO in
-- a service-role write. The callers set it; a null simply renders as the plain
-- date with no name, which is honest — "edited, by someone we did not record"
-- rather than a wrong name.

-- ── COLUMNS ────────────────────────────────────────────────────────────────
alter table if exists public.task_templates
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

alter table if exists public.engagement_templates
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

alter table if exists public.firm_services
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

-- ── THE TRIGGER ────────────────────────────────────────────────────────────
-- One function, three tables. `before update` so the new value is written with
-- the row rather than costing a second write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'task_templates_touch_updated_at'
  ) then
    create trigger task_templates_touch_updated_at
      before update on public.task_templates
      for each row execute function public.touch_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'engagement_templates_touch_updated_at'
  ) then
    create trigger engagement_templates_touch_updated_at
      before update on public.engagement_templates
      for each row execute function public.touch_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'firm_services_touch_updated_at'
  ) then
    create trigger firm_services_touch_updated_at
      before update on public.firm_services
      for each row execute function public.touch_updated_at();
  end if;
end $$;

comment on column public.task_templates.updated_at is
  'Set by trigger on every update. Existing rows default to now() at migration time, which reads as "edited today" once — the alternative was backfilling from created_at and claiming a template had never been touched, which is a stronger and less recoverable lie.';
comment on column public.task_templates.updated_by_user_id is
  'Set by the CALLER, not the trigger — the database cannot know who in a service-role write. Null renders as the date with no name.';
