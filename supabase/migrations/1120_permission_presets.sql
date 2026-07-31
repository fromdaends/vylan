-- 1120_permission_presets.sql
--
-- Where a person's permissions actually live. The storage half of Phase 2's
-- "per-person switches"; the UI half is separate and deliberately not in this
-- change.
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
--
-- NOT a third value on users.role. The rank stays 'owner' | 'staff' forever,
-- because RLS reads the rank — adding a third would mean re-deciding every
-- policy in the schema, including the private-client rules in 0810 that 26
-- tables hang off. A preset is an APPLICATION concept layered on top, which is
-- why re-cutting one is a code change with tests rather than a migration.
--
-- ── THE TWO COLUMNS ──────────────────────────────────────────────────────────
--
-- permission_preset — 'member' | 'junior', or NULL.
--   NULL is the important value: it means "not set", which src/lib/auth/
--   capabilities.ts resolves to MEMBER. Every existing row is NULL, so every
--   existing staff member keeps exactly the access they have today and this
--   migration changes nothing for anybody. There is deliberately NO backfill.
--
--   'owner' is NOT an allowed value even though it is a preset in code. The
--   rank is what RLS reads; a staff row claiming the owner preset would render
--   owner controls that every database policy then refuses. resolvePreset()
--   already refuses to honour it — the CHECK makes it unstorable too, so the
--   two layers agree.
--
-- extra_capabilities — per-person grants ON TOP of the preset.
--   The escape hatch that makes "Sarah also approves timesheets" possible
--   without inventing a rank for it. Phase 8's time approver is exactly this.
--   Unknown strings are ignored at read time (capabilitiesFor), so a rolled-back
--   feature leaves dead grants behind harmlessly rather than breaking a page.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────
--
-- READING is already safe without this migration: the three call sites that
-- load a user were widened to select("*") in the first Phase 2 change precisely
-- so naming a new column could never 42703. Missing columns arrive as
-- undefined, and resolvePreset treats undefined exactly like NULL — member.
--
-- WRITING is not. Any UI that sets a preset will PGRST204 until this is
-- applied. That is why the switches are a separate change: this can go in
-- first, on its own, and sit inert.
--
-- Idempotent throughout: add-column-if-not-exists, and the constraint is
-- guarded on pg_constraint so a re-run is a no-op rather than an error.

alter table public.users
  add column if not exists permission_preset text,
  add column if not exists extra_capabilities text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_permission_preset_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_permission_preset_check
      check (permission_preset is null or permission_preset in ('member', 'junior'));
  end if;
end $$;

comment on column public.users.permission_preset is
  'Application-level permission preset: ''member'' | ''junior'', or NULL = not set, which resolves to MEMBER in src/lib/auth/capabilities.ts. Deliberately NOT a third users.role value — the rank stays owner/staff because RLS reads it. ''owner'' is unstorable on purpose: a staff row claiming it would render owner controls that RLS then refuses.';

comment on column public.users.extra_capabilities is
  'Per-person capability grants ON TOP of the preset — the escape hatch for "this one person also does X" without inventing a rank (Phase 8''s time approver). Strings not in CAPABILITIES are ignored at read time, so a removed feature leaves harmless dead grants rather than breaking pages.';
