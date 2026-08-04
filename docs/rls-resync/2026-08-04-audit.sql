-- ════════════════════════════════════════════════════════════════════════
-- VYLAN — PROD RLS AUDIT (read-only)                     generated 2026-08-04
-- Dumps everything about row-level security so drift is visible and we keep
-- a record: migration ledger, RLS flags, every policy (in 160-char chunks —
-- the SQL editor truncates wide cells, chunks survive), helper-function
-- bodies, and a per-table policy-count check against the repo.
-- Paste the WHOLE file, Run once, send back the output (Export CSV if long).
-- Changes NOTHING. Run it before resync.sql (the "before" record) and after
-- (the proof).
-- ════════════════════════════════════════════════════════════════════════
with expected(tbl, n) as (values
  ('public.activity_log', 2),
  ('public.ai_rejection_overrides', 1),
  ('public.ai_usage_monthly', 1),
  ('public.bank_statement_balances', 1),
  ('public.chat_conversations', 2),
  ('public.chat_messages', 2),
  ('public.chat_pending_actions', 1),
  ('public.client_import_sessions', 1),
  ('public.client_members', 1),
  ('public.client_message_threads', 3),
  ('public.client_messages', 2),
  ('public.client_notes', 3),
  ('public.client_relationships', 1),
  ('public.clients', 1),
  ('public.demo_requests', 0),
  ('public.document_folders', 1),
  ('public.document_import_runs', 1),
  ('public.document_texts', 1),
  ('public.engagement_members', 1),
  ('public.engagement_task_assignees', 1),
  ('public.engagement_tasks', 1),
  ('public.engagements', 1),
  ('public.feedback', 2),
  ('public.file_comments', 3),
  ('public.filed_documents', 1),
  ('public.filing_runs', 1),
  ('public.final_documents', 1),
  ('public.firm_filing_settings', 3),
  ('public.firm_invites', 1),
  ('public.firm_invoice_settings', 3),
  ('public.firm_links', 1),
  ('public.firm_roles', 1),
  ('public.firms', 2),
  ('public.imported_documents', 1),
  ('public.invoice_payments', 1),
  ('public.jobs', 0),
  ('public.month_end_closes', 1),
  ('public.notification_mutes', 1),
  ('public.notification_preferences', 1),
  ('public.notification_settings', 1),
  ('public.notifications', 2),
  ('public.organize_suggestions', 1),
  ('public.payment_requests', 1),
  ('public.payout_journal_drafts', 1),
  ('public.quickbooks_accounts', 1),
  ('public.quickbooks_connections', 1),
  ('public.quickbooks_customers', 1),
  ('public.quickbooks_items', 1),
  ('public.quickbooks_learned_mappings', 1),
  ('public.quickbooks_tax_codes', 1),
  ('public.quickbooks_transaction_suggestions', 1),
  ('public.quickbooks_vendors', 1),
  ('public.recurring_occurrences', 2),
  ('public.recurring_series', 3),
  ('public.reminders', 1),
  ('public.request_items', 1),
  ('public.signature_requests', 1),
  ('public.storage_connections', 1),
  ('public.task_statuses', 2),
  ('public.team_message_reads', 1),
  ('public.team_messages', 3),
  ('public.templates', 2),
  ('public.uploaded_files', 1),
  ('public.user_firm_roles', 1),
  ('public.user_mfa_recovery_codes', 1),
  ('public.users', 2),
  ('public.xero_accounts', 1),
  ('public.xero_connections', 1),
  ('public.xero_contacts', 1),
  ('public.xero_items', 1),
  ('public.xero_tax_rates', 1),
  ('public.xero_tracking_options', 1),
  ('storage.objects', 1)
),
pol as (
  select schemaname||'.'||tablename as tbl, policyname as pol,
         cmd||' | to '||array_to_string(roles, ',')||' | '||permissive||' | USING: '||coalesce(qual, '—')||' | CHECK: '||coalesce(with_check, '—') as body
    from pg_policies where schemaname in ('public','storage')
),
fn as (
  select p.proname, pg_get_functiondef(p.oid) as body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('client_assigned_to_me','client_has_member','client_is_private','conversation_is_private','current_firm_allows_member_invites','current_firm_id','current_user_is_external','current_user_is_owner','engagement_has_member','engagement_is_private','on_an_engagement_for_client','series_is_private','shares_a_client_with_me')
)
select * from (
  select '1-ledger' as section, lpad(version, 12) as a, '' as b, 1 as seq,
         'migration recorded as applied' as content
    from supabase_migrations.schema_migrations
  union all
  select '2-rls-flag', n.nspname||'.'||c.relname, '', 1,
         case when c.relrowsecurity then 'RLS ENABLED' else 'RLS *** OFF ***' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','storage') and c.relkind = 'r'
  union all
  select '3-policy', tbl, pol, seg,
         substr(body, (seg-1)*160+1, 160)
    from pol, generate_series(1, (length(body)+159)/160) as seg
  union all
  select '4-function', proname, md5(body), seg,
         substr(body, (seg-1)*160+1, 160)
    from fn, generate_series(1, (length(body)+159)/160) as seg
  union all
  select '5-count-check', e.tbl, '', 1,
         'expected '||e.n||' policies, prod has '||count(p.pol)||
         case when count(p.pol) = e.n then ' — ok' else ' — *** MISMATCH ***' end
    from expected e left join pol p on p.tbl = e.tbl
   group by e.tbl, e.n
) dump
order by section, a, b, seq;
