-- Proves 1720 actually took effect. Read-only; writes nothing.
--
-- ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
--
-- 1720 fixes the highest-consequence bug in this arc: "invoice when the client
-- accepts" was rejected by the database, so choosing it failed the whole
-- engagement save. It works by DROPPING the old CHECK and adding a wider one.
--
-- That has a silent failure mode. `drop constraint if exists <name>` no-ops when
-- the name is wrong, and Postgres requires ALL check constraints on a column to
-- pass — so a mistargeted drop leaves the old narrow constraint in place beside
-- the new wide one, and 'on_acceptance' is still rejected. The migration
-- succeeds, the deploy is green, and the feature is still broken.
--
-- This repo has been burned by exactly this shape before: migration 1370 shipped
-- SQL that could never have run and left a feature inert on production for
-- hours, because nothing ever read the result back.
--
-- Testing a CHECK the obvious way means writing a row to the founder's live
-- database. So instead this asks the catalogue directly, server-side, and RAISES
-- if the answer is wrong. Applying it is the verification: silence means correct.

do $$
declare
  n_checks integer;
  bad_defs text;
begin
  -- Every CHECK constraint on engagements that mentions invoice_auto_mode.
  select count(*),
         string_agg(pg_get_constraintdef(c.oid), ' | ')
    into n_checks, bad_defs
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'engagements'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%invoice_auto_mode%';

  if n_checks = 0 then
    raise exception
      'VERIFY FAILED: no CHECK on engagements.invoice_auto_mode at all. 1720 dropped the old one and did not add the new one.';
  end if;

  -- More than one means 1720's DROP missed and the old narrow rule survives
  -- alongside the new one. Both must pass, so the feature is still broken.
  if n_checks > 1 then
    raise exception
      'VERIFY FAILED: % CHECK constraints on engagements.invoice_auto_mode — the old one was not dropped. Definitions: %',
      n_checks, bad_defs;
  end if;

  if bad_defs not ilike '%on_acceptance%' then
    raise exception
      'VERIFY FAILED: the CHECK on engagements.invoice_auto_mode still rejects on_acceptance. Definition: %',
      bad_defs;
  end if;

  raise notice 'VERIFIED: engagements.invoice_auto_mode accepts on_acceptance. Definition: %', bad_defs;
end $$;
