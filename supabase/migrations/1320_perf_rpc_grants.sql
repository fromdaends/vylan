-- Re-grant EXECUTE on the five performance RPCs.
--
-- WHAT WENT WRONG. Production reports `42501 permission denied for function
-- perf_action_count` on every page that reads the automation counts. The
-- functions exist and 0820 already contains the right grants — so this is not
-- a missing definition, it is a missing GRANT on the live database.
--
-- The shape of 0820 explains how. It is exactly 150 lines: the five
-- `revoke all ... from public, anon` statements are lines 140-144, and the five
-- `grant execute ... to authenticated` statements are lines 146-150 — the LAST
-- FIVE LINES OF THE FILE. Applying that migration by pasting it into the SQL
-- editor, with the paste truncated even slightly, creates the functions, strips
-- the default PUBLIC execute right, and never restores it to `authenticated`.
-- Every symptom follows from that, and it fails for ALL FIVE functions at once,
-- not just the one that happened to show up in the logs.
--
-- WHY IT WAS INVISIBLE. Every caller falls back to an RLS-scoped query when the
-- RPC errors (see lib/performance/automation.ts), so the numbers on screen have
-- been RIGHT for owners the whole time — RLS shows an owner everything the
-- definer function would have. The damage is narrower than it looks: a non-owner
-- staff member's totals silently omit private clients' events, because that is
-- precisely what the definer RPC existed to include. Plus an error line on every
-- render.
--
-- Grants are idempotent, so this is safe to run repeatedly and safe on a
-- database where 0820 applied cleanly (it re-asserts what is already true).
-- Deliberately does NOT re-run the revokes: this migration's whole job is to
-- restore access, and re-revoking first would reopen the same window it closes.

do $$
begin
  -- Each grant is guarded so a database missing one of these functions (0820
  -- not applied at all) gets the ones it does have rather than erroring out on
  -- the first line and leaving the rest ungranted — the same partial-apply
  -- failure this migration exists to repair.
  if to_regprocedure('public.perf_paid_invoices(timestamptz)') is not null then
    grant execute on function public.perf_paid_invoices(timestamptz) to authenticated;
  end if;

  if to_regprocedure('public.perf_outstanding_invoices()') is not null then
    grant execute on function public.perf_outstanding_invoices() to authenticated;
  end if;

  if to_regprocedure('public.perf_received_docs(timestamptz)') is not null then
    grant execute on function public.perf_received_docs(timestamptz) to authenticated;
  end if;

  if to_regprocedure('public.perf_pending_docs_count()') is not null then
    grant execute on function public.perf_pending_docs_count() to authenticated;
  end if;

  if to_regprocedure('public.perf_action_count(text, timestamptz)') is not null then
    grant execute on function public.perf_action_count(text, timestamptz) to authenticated;
  end if;
end
$$;

-- Verify after applying — expect five rows, all with has_execute = true:
--
--   select p.proname,
--          has_function_privilege('authenticated', p.oid, 'execute') as has_execute
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname like 'perf\_%'
--    order by p.proname;
