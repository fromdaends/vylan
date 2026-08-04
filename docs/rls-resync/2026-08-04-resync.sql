-- ════════════════════════════════════════════════════════════════════════
-- VYLAN — PRODUCTION RLS RE-SYNC                        generated 2026-08-04
-- Source of truth: supabase/migrations up to 1430_subtasks.sql (159 files),
-- replayed in order; this file re-asserts the FINAL state of every row-level
-- security policy (96 policies on 71 tables) and the 13 helper functions
-- those policies call. Written after prod was found running a years-old
-- engagements_all (pre-0990 shape) while the ledger claimed 1220/1240/1320
-- were applied.
--
-- HOW TO RUN: paste this WHOLE file into the Supabase SQL editor and press
-- Run ONCE. It executes as a single transaction: if anything fails, NOTHING
-- is changed and the error tells us what to fix. Safe to run twice (second
-- run reports "already matched" everywhere). It never touches data rows.
--
-- WHAT IT DOES, per table (alphabetical):
--   1. ensures row-level security is ON;
--   2. drops + recreates each policy exactly as the migrations define it;
--   3. drops any EXTRA policy on that table that the repo does not define
--      (recorded in the report; storage.objects extras are only REPORTED).
--   A table that errors (e.g. a column a pending migration adds is missing)
--   is SKIPPED as a unit — its old policies stay — and shows in the report.
--
-- THE LAST STATEMENT PRINTS THE REPORT. Send me that output.
-- ════════════════════════════════════════════════════════════════════════

set search_path = public;
set check_function_bodies = off;

-- Snapshot the BEFORE state so the report can show what actually changed.
create temp table _rls_before on commit drop as
  select schemaname||'.'||tablename as tbl, policyname as pol, cmd, permissive,
         array_to_string(roles, ',') as roles, qual, with_check
    from pg_policies where schemaname in ('public','storage');
create temp table _fns_before on commit drop as
  select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('client_assigned_to_me','client_has_member','client_is_private','conversation_is_private','current_firm_allows_member_invites','current_firm_id','current_user_is_external','current_user_is_owner','engagement_has_member','engagement_is_private','on_an_engagement_for_client','series_is_private','shares_a_client_with_me');
create temp table _skipped (tbl text, reason text) on commit drop;
create temp table _extras_dropped (tbl text, pol text, cmd text, roles text, qual text, with_check text) on commit drop;

-- ── 1. Helper functions the policies call (verbatim last definitions) ────
-- current_user_is_owner stays the 0190 rank-based body ON PURPOSE: 1290 made
-- the Owner ROLE real but kept RLS on users.role — permissions never moved.

do $sync$
begin
  execute $fnddl$
create or replace function public.client_assigned_to_me(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.assigned_user_id = auth.uid()
    from public.clients c
    where c.id = cid and c.firm_id = public.current_firm_id()
  ), false)
$$
$fnddl$;
  execute $fnddl$
comment on function public.client_assigned_to_me(uuid) is
  'True when the given client is assigned to the calling user (clients.assigned_user_id, 0210). Firm-self-scoped. Used by clients_all / engagements_all so a staff member can see work handed to them even when it is private.'
$fnddl$;
exception when others then
  insert into _skipped values ('function public.client_assigned_to_me', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.client_has_member(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select exists (
      select 1 from public.client_members m
      where m.client_id = cid
        and m.user_id = auth.uid()
    )
  ), false)
$$
$fnddl$;
  execute $fnddl$
comment on function public.client_has_member(uuid) is
  'True when the calling user is on the given client''s team (client_members, 1210). SECURITY DEFINER so a policy on clients can call it without re-entering client_members'' own policy. Used by clients_all / engagements_all.'
$fnddl$;
exception when others then
  insert into _skipped values ('function public.client_has_member', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.client_is_private(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select is_private from public.clients
    where id = cid and firm_id = public.current_firm_id()
  ), false)
$$
$fnddl$;
  execute $fnddl$
comment on function public.client_is_private(uuid) is
  'True if the given client is marked "Private to me". Security-definer so it reads the real flag regardless of the caller''s RLS visibility (avoids the RLS-in-subquery leak). Returns only a boolean; no cross-firm data leaves it.'
$fnddl$;
exception when others then
  insert into _skipped values ('function public.client_is_private', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.conversation_is_private(convid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.is_private
    from public.chat_conversations cc
    join public.engagements e on e.id = cc.engagement_id
    join public.clients c on c.id = e.client_id
    where cc.id = convid and cc.firm_id = public.current_firm_id()
  ), false)
$$
$fnddl$;
  execute $fnddl$
comment on function public.conversation_is_private(uuid) is
  'True if the given AI-chat conversation''s client is marked "Private to me". Security-definer (see client_is_private) — used because chat_messages reaches the engagement only through the RLS-gated chat_conversations.'
$fnddl$;
exception when others then
  insert into _skipped values ('function public.conversation_is_private', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.current_firm_allows_member_invites()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.firms f
    where f.id = public.current_firm_id()
      and f.invite_policy = 'members'
  )
$$
$fnddl$;
exception when others then
  insert into _skipped values ('function public.current_firm_allows_member_invites', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.current_firm_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select firm_id from public.users where id = auth.uid()
$$
$fnddl$;
exception when others then
  insert into _skipped values ('function public.current_firm_id', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.current_user_is_external()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.is_external from users u where u.id = auth.uid()),
    false
  );
$$
$fnddl$;
exception when others then
  insert into _skipped values ('function public.current_user_is_external', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.current_user_is_owner() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'owner'
  )
$$
$fnddl$;
exception when others then
  insert into _skipped values ('function public.current_user_is_owner', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.engagement_has_member(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from engagement_members em
     where em.engagement_id = eid and em.user_id = auth.uid()
  );
$$
$fnddl$;
  execute $fnddl$
comment on function public.engagement_has_member(uuid) is
  'True when the caller was explicitly added to this ONE engagement (1310). Beats both privacy flags on purpose — "into one job without opening the whole client" is exactly the private-client case.'
$fnddl$;
exception when others then
  insert into _skipped values ('function public.engagement_has_member', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.engagement_is_private(eid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    -- Explicitly on this job: it is not private TO YOU. Every child table's
    -- read arm asks this one question, so this single branch is what lets a
    -- per-engagement member open the documents and files under it.
    when public.engagement_has_member(eid) then false
    else coalesce((
      select (c.is_private or e.is_private)
      from public.engagements e
      join public.clients c on c.id = e.client_id
      where e.id = eid and e.firm_id = public.current_firm_id()
    ), false)
  end
$$
$fnddl$;
  execute $fnddl$
comment on function public.engagement_is_private(uuid) is
  'True if the engagement or its client is marked private AND the caller is not explicitly on the engagement (1310). Security-definer; read by ten child-table policies, which is why the membership branch lives here rather than in each of them.'
$fnddl$;
exception when others then
  insert into _skipped values ('function public.engagement_is_private', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.on_an_engagement_for_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from engagement_members em
      join engagements e on e.id = em.engagement_id
     where em.user_id = auth.uid() and e.client_id = cid
  );
$$
$fnddl$;
exception when others then
  insert into _skipped values ('function public.on_an_engagement_for_client', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.series_is_private(sid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.is_private
    from public.recurring_series s
    join public.clients c on c.id = s.client_id
    where s.id = sid and s.firm_id = public.current_firm_id()
  ), false)
$$
$fnddl$;
  execute $fnddl$
comment on function public.series_is_private(uuid) is
  'True if the given recurring series'' client is marked "Private to me". Security-definer (see client_is_private) — used because recurring_occurrences reaches the client only through the RLS-gated recurring_series.'
$fnddl$;
exception when others then
  insert into _skipped values ('function public.series_is_private', sqlerrm);
end $sync$;

do $sync$
begin
  execute $fnddl$
create or replace function public.shares_a_client_with_me(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from client_members mine
      join client_members theirs on theirs.client_id = mine.client_id
     where mine.user_id = auth.uid()
       and theirs.user_id = p_user_id
  );
$$
$fnddl$;
exception when others then
  insert into _skipped values ('function public.shares_a_client_with_me', sqlerrm);
end $sync$;

-- ── 2. Tables, alphabetical ──────────────────────────────────────────────

-- ═══ public.activity_log ═══ expected: activity_log_insert (0002_rls.sql), activity_log_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.activity_log') is null then
    insert into _skipped values ('public.activity_log', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.activity_log enable row level security';
  execute 'drop policy if exists "activity_log_insert" on public.activity_log';
  execute $ddl$
create policy activity_log_insert on activity_log for insert
  with check (firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "activity_log_select" on public.activity_log';
  execute $ddl$
create policy activity_log_select on public.activity_log
  for select using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or engagement_id is null
      or not public.engagement_is_private(engagement_id)
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'activity_log'
                  and policyname not in ('activity_log_insert', 'activity_log_select') loop
      insert into _extras_dropped values ('public.activity_log', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.activity_log', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.activity_log', sqlerrm);
end $sync$;

-- ═══ public.ai_rejection_overrides ═══ expected: ai_rejection_overrides_all (0029_ai_usability.sql)
do $sync$
begin
  if to_regclass('public.ai_rejection_overrides') is null then
    insert into _skipped values ('public.ai_rejection_overrides', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.ai_rejection_overrides enable row level security';
  execute 'drop policy if exists "ai_rejection_overrides_all" on public.ai_rejection_overrides';
  execute $ddl$
create policy ai_rejection_overrides_all on ai_rejection_overrides for all
  using (
    exists (
      select 1
      from uploaded_files f
      join engagements e on e.id = f.engagement_id
      where f.id = ai_rejection_overrides.file_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1
      from uploaded_files f
      join engagements e on e.id = f.engagement_id
      where f.id = ai_rejection_overrides.file_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'ai_rejection_overrides'
                  and policyname not in ('ai_rejection_overrides_all') loop
      insert into _extras_dropped values ('public.ai_rejection_overrides', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.ai_rejection_overrides', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.ai_rejection_overrides', sqlerrm);
end $sync$;

-- ═══ public.ai_usage_monthly ═══ expected: ai_usage_monthly_select (0230_ai_monthly_cap.sql)
do $sync$
begin
  if to_regclass('public.ai_usage_monthly') is null then
    insert into _skipped values ('public.ai_usage_monthly', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.ai_usage_monthly enable row level security';
  execute 'drop policy if exists "ai_usage_monthly_select" on public.ai_usage_monthly';
  execute $ddl$
create policy ai_usage_monthly_select on ai_usage_monthly for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'ai_usage_monthly'
                  and policyname not in ('ai_usage_monthly_select') loop
      insert into _extras_dropped values ('public.ai_usage_monthly', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.ai_usage_monthly', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.ai_usage_monthly', sqlerrm);
end $sync$;

-- ═══ public.bank_statement_balances ═══ expected: bank_statement_balances_all (1230_bank_statement_balances.sql)
do $sync$
begin
  if to_regclass('public.bank_statement_balances') is null then
    insert into _skipped values ('public.bank_statement_balances', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.bank_statement_balances enable row level security';
  execute 'drop policy if exists "bank_statement_balances_all" on public.bank_statement_balances';
  execute $ddl$
create policy bank_statement_balances_all on bank_statement_balances for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'bank_statement_balances'
                  and policyname not in ('bank_statement_balances_all') loop
      insert into _extras_dropped values ('public.bank_statement_balances', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.bank_statement_balances', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.bank_statement_balances', sqlerrm);
end $sync$;

-- ═══ public.chat_conversations ═══ expected: chat_conversations_insert (0550_engagement_chat.sql), chat_conversations_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.chat_conversations') is null then
    insert into _skipped values ('public.chat_conversations', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.chat_conversations enable row level security';
  execute 'drop policy if exists "chat_conversations_insert" on public.chat_conversations';
  execute $ddl$
create policy chat_conversations_insert on chat_conversations for insert
  with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from engagements e
      where e.id = engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  execute 'drop policy if exists "chat_conversations_select" on public.chat_conversations';
  execute $ddl$
create policy chat_conversations_select on public.chat_conversations
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'chat_conversations'
                  and policyname not in ('chat_conversations_insert', 'chat_conversations_select') loop
      insert into _extras_dropped values ('public.chat_conversations', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.chat_conversations', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.chat_conversations', sqlerrm);
end $sync$;

-- ═══ public.chat_messages ═══ expected: chat_messages_insert (0550_engagement_chat.sql), chat_messages_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.chat_messages') is null then
    insert into _skipped values ('public.chat_messages', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.chat_messages enable row level security';
  execute 'drop policy if exists "chat_messages_insert" on public.chat_messages';
  execute $ddl$
create policy chat_messages_insert on chat_messages for insert
  with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from chat_conversations c
      where c.id = conversation_id
        and c.firm_id = public.current_firm_id()
    )
    and (
      (role = 'user' and user_id = auth.uid())
      or (role = 'assistant' and user_id is null)
    )
  )
$ddl$;
  execute 'drop policy if exists "chat_messages_select" on public.chat_messages';
  execute $ddl$
create policy chat_messages_select on public.chat_messages
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.conversation_is_private(conversation_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'chat_messages'
                  and policyname not in ('chat_messages_insert', 'chat_messages_select') loop
      insert into _extras_dropped values ('public.chat_messages', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.chat_messages', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.chat_messages', sqlerrm);
end $sync$;

-- ═══ public.chat_pending_actions ═══ expected: chat_pending_actions_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.chat_pending_actions') is null then
    insert into _skipped values ('public.chat_pending_actions', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.chat_pending_actions enable row level security';
  execute 'drop policy if exists "chat_pending_actions_select" on public.chat_pending_actions';
  execute $ddl$
create policy chat_pending_actions_select on public.chat_pending_actions
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'chat_pending_actions'
                  and policyname not in ('chat_pending_actions_select') loop
      insert into _extras_dropped values ('public.chat_pending_actions', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.chat_pending_actions', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.chat_pending_actions', sqlerrm);
end $sync$;

-- ═══ public.client_import_sessions ═══ expected: client_import_sessions_select (0750_client_import_sessions.sql)
do $sync$
begin
  if to_regclass('public.client_import_sessions') is null then
    insert into _skipped values ('public.client_import_sessions', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.client_import_sessions enable row level security';
  execute 'drop policy if exists "client_import_sessions_select" on public.client_import_sessions';
  execute $ddl$
create policy client_import_sessions_select on client_import_sessions for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'client_import_sessions'
                  and policyname not in ('client_import_sessions_select') loop
      insert into _extras_dropped values ('public.client_import_sessions', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.client_import_sessions', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.client_import_sessions', sqlerrm);
end $sync$;

-- ═══ public.client_members ═══ expected: client_members_all (1210_client_members.sql)
do $sync$
begin
  if to_regclass('public.client_members') is null then
    insert into _skipped values ('public.client_members', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.client_members enable row level security';
  execute 'drop policy if exists "client_members_all" on public.client_members';
  execute $ddl$
create policy client_members_all on client_members for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'client_members'
                  and policyname not in ('client_members_all') loop
      insert into _extras_dropped values ('public.client_members', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.client_members', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.client_members', sqlerrm);
end $sync$;

-- ═══ public.client_message_threads ═══ expected: client_message_threads_insert (0650_client_messages.sql), client_message_threads_select (0810_client_private.sql), client_message_threads_update (0650_client_messages.sql)
do $sync$
begin
  if to_regclass('public.client_message_threads') is null then
    insert into _skipped values ('public.client_message_threads', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.client_message_threads enable row level security';
  execute 'drop policy if exists "client_message_threads_insert" on public.client_message_threads';
  execute $ddl$
create policy client_message_threads_insert on client_message_threads
  for insert with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from engagements e
      where e.id = engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  execute 'drop policy if exists "client_message_threads_select" on public.client_message_threads';
  execute $ddl$
create policy client_message_threads_select on public.client_message_threads
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
$ddl$;
  execute 'drop policy if exists "client_message_threads_update" on public.client_message_threads';
  execute $ddl$
create policy client_message_threads_update on client_message_threads
  for update using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'client_message_threads'
                  and policyname not in ('client_message_threads_insert', 'client_message_threads_select', 'client_message_threads_update') loop
      insert into _extras_dropped values ('public.client_message_threads', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.client_message_threads', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.client_message_threads', sqlerrm);
end $sync$;

-- ═══ public.client_messages ═══ expected: client_messages_insert (0650_client_messages.sql), client_messages_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.client_messages') is null then
    insert into _skipped values ('public.client_messages', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.client_messages enable row level security';
  execute 'drop policy if exists "client_messages_insert" on public.client_messages';
  execute $ddl$
create policy client_messages_insert on client_messages
  for insert with check (
    firm_id = public.current_firm_id()
    and sender = 'firm'
    and sender_user_id = auth.uid()
    and exists (
      select 1 from engagements e
      where e.id = engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  execute 'drop policy if exists "client_messages_select" on public.client_messages';
  execute $ddl$
create policy client_messages_select on public.client_messages
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'client_messages'
                  and policyname not in ('client_messages_insert', 'client_messages_select') loop
      insert into _extras_dropped values ('public.client_messages', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.client_messages', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.client_messages', sqlerrm);
end $sync$;

-- ═══ public.client_notes ═══ expected: client_notes_delete (1270_client_notes.sql), client_notes_insert (1270_client_notes.sql), client_notes_select (1270_client_notes.sql)
do $sync$
begin
  if to_regclass('public.client_notes') is null then
    insert into _skipped values ('public.client_notes', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.client_notes enable row level security';
  execute 'drop policy if exists "client_notes_delete" on public.client_notes';
  execute $ddl$
create policy client_notes_delete on client_notes for delete
  using (
    firm_id = public.current_firm_id()
    and author_user_id = auth.uid()
  )
$ddl$;
  execute 'drop policy if exists "client_notes_insert" on public.client_notes';
  execute $ddl$
create policy client_notes_insert on client_notes for insert
  with check (
    firm_id = public.current_firm_id()
    and author_user_id = auth.uid()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  execute 'drop policy if exists "client_notes_select" on public.client_notes';
  execute $ddl$
create policy client_notes_select on client_notes for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'client_notes'
                  and policyname not in ('client_notes_delete', 'client_notes_insert', 'client_notes_select') loop
      insert into _extras_dropped values ('public.client_notes', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.client_notes', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.client_notes', sqlerrm);
end $sync$;

-- ═══ public.client_relationships ═══ expected: client_relationships_all (1150_client_relationships.sql)
do $sync$
begin
  if to_regclass('public.client_relationships') is null then
    insert into _skipped values ('public.client_relationships', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.client_relationships enable row level security';
  execute 'drop policy if exists "client_relationships_all" on public.client_relationships';
  execute $ddl$
create policy client_relationships_all on client_relationships for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(from_client_id)
        and not public.client_is_private(to_client_id)
      )
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(from_client_id)
        and not public.client_is_private(to_client_id)
      )
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'client_relationships'
                  and policyname not in ('client_relationships_all') loop
      insert into _extras_dropped values ('public.client_relationships', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.client_relationships', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.client_relationships', sqlerrm);
end $sync$;

-- ═══ public.clients ═══ expected: clients_all (1320_engagement_members.sql)
do $sync$
begin
  if to_regclass('public.clients') is null then
    insert into _skipped values ('public.clients', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.clients enable row level security';
  execute 'drop policy if exists "clients_all" on public.clients';
  execute $ddl$
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or assigned_user_id = auth.uid()
      or public.client_has_member(id)
      or public.on_an_engagement_for_client(id)
      or (
        coalesce(visibility, 'members') = 'listed'
        and not public.current_user_is_external()
      )
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (coalesce(is_private, false) = false or public.current_user_is_owner())
    and (
      coalesce(visibility, 'members') <> 'listed'
      or public.current_user_is_owner()
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'clients'
                  and policyname not in ('clients_all') loop
      insert into _extras_dropped values ('public.clients', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.clients', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.clients', sqlerrm);
end $sync$;

-- ═══ public.demo_requests ═══ deny-all by design: RLS on, ZERO policies (service-role access only)
do $sync$
begin
  if to_regclass('public.demo_requests') is null then
    insert into _skipped values ('public.demo_requests', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.demo_requests enable row level security';
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'demo_requests'
                   loop
      insert into _extras_dropped values ('public.demo_requests', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.demo_requests', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.demo_requests', sqlerrm);
end $sync$;

-- ═══ public.document_folders ═══ expected: document_folders_all (1100_custom_folders.sql)
do $sync$
begin
  if to_regclass('public.document_folders') is null then
    insert into _skipped values ('public.document_folders', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.document_folders enable row level security';
  execute 'drop policy if exists "document_folders_all" on public.document_folders';
  execute $ddl$
create policy document_folders_all on document_folders for all
  using (
    deleted_at is null
    and firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'document_folders'
                  and policyname not in ('document_folders_all') loop
      insert into _extras_dropped values ('public.document_folders', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.document_folders', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.document_folders', sqlerrm);
end $sync$;

-- ═══ public.document_import_runs ═══ expected: document_import_runs_select (1070_files_section.sql)
do $sync$
begin
  if to_regclass('public.document_import_runs') is null then
    insert into _skipped values ('public.document_import_runs', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.document_import_runs enable row level security';
  execute 'drop policy if exists "document_import_runs_select" on public.document_import_runs';
  execute $ddl$
create policy document_import_runs_select on document_import_runs for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'document_import_runs'
                  and policyname not in ('document_import_runs_select') loop
      insert into _extras_dropped values ('public.document_import_runs', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.document_import_runs', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.document_import_runs', sqlerrm);
end $sync$;

-- ═══ public.document_texts ═══ expected: document_texts_select (1171_document_texts.sql)
do $sync$
begin
  if to_regclass('public.document_texts') is null then
    insert into _skipped values ('public.document_texts', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.document_texts enable row level security';
  execute 'drop policy if exists "document_texts_select" on public.document_texts';
  execute $ddl$
create policy document_texts_select on document_texts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'document_texts'
                  and policyname not in ('document_texts_select') loop
      insert into _extras_dropped values ('public.document_texts', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.document_texts', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.document_texts', sqlerrm);
end $sync$;

-- ═══ public.engagement_members ═══ expected: engagement_members_select (1320_engagement_members.sql)
do $sync$
begin
  if to_regclass('public.engagement_members') is null then
    insert into _skipped values ('public.engagement_members', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.engagement_members enable row level security';
  execute 'drop policy if exists "engagement_members_select" on public.engagement_members';
  execute $ddl$
create policy engagement_members_select on engagement_members for select
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.engagement_has_member(engagement_id)
      or not public.engagement_is_private(engagement_id)
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'engagement_members'
                  and policyname not in ('engagement_members_select') loop
      insert into _extras_dropped values ('public.engagement_members', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.engagement_members', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.engagement_members', sqlerrm);
end $sync$;

-- ═══ public.engagement_task_assignees ═══ expected: engagement_task_assignees_all (1350_tasks_belong_to_clients.sql)
do $sync$
begin
  if to_regclass('public.engagement_task_assignees') is null then
    insert into _skipped values ('public.engagement_task_assignees', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.engagement_task_assignees enable row level security';
  execute 'drop policy if exists "engagement_task_assignees_all" on public.engagement_task_assignees';
  execute $ddl$
create policy engagement_task_assignees_all on engagement_task_assignees for all
  using (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from public.engagement_tasks t
       where t.id = task_id and t.firm_id = public.current_firm_id()
    )
  )
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'engagement_task_assignees'
                  and policyname not in ('engagement_task_assignees_all') loop
      insert into _extras_dropped values ('public.engagement_task_assignees', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.engagement_task_assignees', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.engagement_task_assignees', sqlerrm);
end $sync$;

-- ═══ public.engagement_tasks ═══ expected: engagement_tasks_all (1350_tasks_belong_to_clients.sql)
do $sync$
begin
  if to_regclass('public.engagement_tasks') is null then
    insert into _skipped values ('public.engagement_tasks', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.engagement_tasks enable row level security';
  execute 'drop policy if exists "engagement_tasks_all" on public.engagement_tasks';
  execute $ddl$
create policy engagement_tasks_all on engagement_tasks for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        engagement_id is not null
        and not public.engagement_is_private(engagement_id)
      )
      or (
        engagement_id is null
        and (
          public.client_assigned_to_me(client_id)
          or public.client_has_member(client_id)
        )
      )
    )
  )
  with check (firm_id = public.current_firm_id())
$ddl$;
  execute $ddl$
comment on policy engagement_tasks_all on public.engagement_tasks is
  'Firm-scoped. A task attached to a JOB follows that job''s visibility; a task attached only to a CLIENT follows the client''s list (client_members). Owners see everything.'
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'engagement_tasks'
                  and policyname not in ('engagement_tasks_all') loop
      insert into _extras_dropped values ('public.engagement_tasks', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.engagement_tasks', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.engagement_tasks', sqlerrm);
end $sync$;

-- ═══ public.engagements ═══ expected: engagements_all (1320_engagement_members.sql)
do $sync$
begin
  if to_regclass('public.engagements') is null then
    insert into _skipped values ('public.engagements', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.engagements enable row level security';
  execute 'drop policy if exists "engagements_all" on public.engagements';
  execute $ddl$
create policy engagements_all on public.engagements for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.engagement_has_member(id)
      or (
        (
          public.client_assigned_to_me(client_id)
          or public.client_has_member(client_id)
        )
        and (
          coalesce(is_private, false) = false
          or assigned_user_id = auth.uid()
        )
      )
    )
  )
  with check (
    
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and coalesce(is_private, false) = false
      )
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'engagements'
                  and policyname not in ('engagements_all') loop
      insert into _extras_dropped values ('public.engagements', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.engagements', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.engagements', sqlerrm);
end $sync$;

-- ═══ public.feedback ═══ expected: feedback_insert (0007_feedback.sql), feedback_select (0007_feedback.sql)
do $sync$
begin
  if to_regclass('public.feedback') is null then
    insert into _skipped values ('public.feedback', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.feedback enable row level security';
  execute 'drop policy if exists "feedback_insert" on public.feedback';
  execute $ddl$
create policy feedback_insert
  on feedback for insert
  to authenticated
  with check (firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "feedback_select" on public.feedback';
  execute $ddl$
create policy feedback_select
  on feedback for select
  to authenticated
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'feedback'
                  and policyname not in ('feedback_insert', 'feedback_select') loop
      insert into _extras_dropped values ('public.feedback', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.feedback', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.feedback', sqlerrm);
end $sync$;

-- ═══ public.file_comments ═══ expected: file_comments_delete (0800_file_comments.sql), file_comments_insert (0800_file_comments.sql), file_comments_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.file_comments') is null then
    insert into _skipped values ('public.file_comments', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.file_comments enable row level security';
  execute 'drop policy if exists "file_comments_delete" on public.file_comments';
  execute $ddl$
create policy file_comments_delete on file_comments
  for delete using (
    firm_id = public.current_firm_id() and author_user_id = auth.uid()
  )
$ddl$;
  execute 'drop policy if exists "file_comments_insert" on public.file_comments';
  execute $ddl$
create policy file_comments_insert on file_comments
  for insert with check (
    firm_id = public.current_firm_id()
    and author_user_id = auth.uid()
    and exists (
      select 1 from engagements e
      where e.id = engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  execute 'drop policy if exists "file_comments_select" on public.file_comments';
  execute $ddl$
create policy file_comments_select on public.file_comments
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'file_comments'
                  and policyname not in ('file_comments_delete', 'file_comments_insert', 'file_comments_select') loop
      insert into _extras_dropped values ('public.file_comments', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.file_comments', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.file_comments', sqlerrm);
end $sync$;

-- ═══ public.filed_documents ═══ expected: filed_documents_select (0900_filing_engine.sql)
do $sync$
begin
  if to_regclass('public.filed_documents') is null then
    insert into _skipped values ('public.filed_documents', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.filed_documents enable row level security';
  execute 'drop policy if exists "filed_documents_select" on public.filed_documents';
  execute $ddl$
create policy filed_documents_select on filed_documents for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'filed_documents'
                  and policyname not in ('filed_documents_select') loop
      insert into _extras_dropped values ('public.filed_documents', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.filed_documents', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.filed_documents', sqlerrm);
end $sync$;

-- ═══ public.filing_runs ═══ expected: filing_runs_select (0900_filing_engine.sql)
do $sync$
begin
  if to_regclass('public.filing_runs') is null then
    insert into _skipped values ('public.filing_runs', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.filing_runs enable row level security';
  execute 'drop policy if exists "filing_runs_select" on public.filing_runs';
  execute $ddl$
create policy filing_runs_select on filing_runs for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'filing_runs'
                  and policyname not in ('filing_runs_select') loop
      insert into _extras_dropped values ('public.filing_runs', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.filing_runs', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.filing_runs', sqlerrm);
end $sync$;

-- ═══ public.final_documents ═══ expected: final_documents_all (1090_document_soft_delete.sql)
do $sync$
begin
  if to_regclass('public.final_documents') is null then
    insert into _skipped values ('public.final_documents', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.final_documents enable row level security';
  execute 'drop policy if exists "final_documents_all" on public.final_documents';
  execute $ddl$
create policy final_documents_all on public.final_documents for all
  using (
    deleted_at is null
    and firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.engagement_is_private(engagement_id)
    )
  )
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'final_documents'
                  and policyname not in ('final_documents_all') loop
      insert into _extras_dropped values ('public.final_documents', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.final_documents', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.final_documents', sqlerrm);
end $sync$;

-- ═══ public.firm_filing_settings ═══ expected: firm_filing_settings_insert (0900_filing_engine.sql), firm_filing_settings_select (0900_filing_engine.sql), firm_filing_settings_update (0900_filing_engine.sql)
do $sync$
begin
  if to_regclass('public.firm_filing_settings') is null then
    insert into _skipped values ('public.firm_filing_settings', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.firm_filing_settings enable row level security';
  execute 'drop policy if exists "firm_filing_settings_insert" on public.firm_filing_settings';
  execute $ddl$
create policy firm_filing_settings_insert on firm_filing_settings
  for insert with check (firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "firm_filing_settings_select" on public.firm_filing_settings';
  execute $ddl$
create policy firm_filing_settings_select on firm_filing_settings
  for select using (firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "firm_filing_settings_update" on public.firm_filing_settings';
  execute $ddl$
create policy firm_filing_settings_update on firm_filing_settings
  for update using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'firm_filing_settings'
                  and policyname not in ('firm_filing_settings_insert', 'firm_filing_settings_select', 'firm_filing_settings_update') loop
      insert into _extras_dropped values ('public.firm_filing_settings', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.firm_filing_settings', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.firm_filing_settings', sqlerrm);
end $sync$;

-- ═══ public.firm_invites ═══ expected: firm_invites_select_owner (1200_firm_invite_policy.sql)
do $sync$
begin
  if to_regclass('public.firm_invites') is null then
    insert into _skipped values ('public.firm_invites', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.firm_invites enable row level security';
  execute 'drop policy if exists "firm_invites_select_owner" on public.firm_invites';
  execute $ddl$
create policy firm_invites_select_owner on firm_invites for select
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or public.current_firm_allows_member_invites()
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'firm_invites'
                  and policyname not in ('firm_invites_select_owner') loop
      insert into _extras_dropped values ('public.firm_invites', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.firm_invites', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.firm_invites', sqlerrm);
end $sync$;

-- ═══ public.firm_invoice_settings ═══ expected: firm_invoice_settings_insert (0751_native_invoices.sql), firm_invoice_settings_select (0751_native_invoices.sql), firm_invoice_settings_update (0751_native_invoices.sql)
do $sync$
begin
  if to_regclass('public.firm_invoice_settings') is null then
    insert into _skipped values ('public.firm_invoice_settings', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.firm_invoice_settings enable row level security';
  execute 'drop policy if exists "firm_invoice_settings_insert" on public.firm_invoice_settings';
  execute $ddl$
create policy firm_invoice_settings_insert on firm_invoice_settings
  for insert with check (firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "firm_invoice_settings_select" on public.firm_invoice_settings';
  execute $ddl$
create policy firm_invoice_settings_select on firm_invoice_settings
  for select using (firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "firm_invoice_settings_update" on public.firm_invoice_settings';
  execute $ddl$
create policy firm_invoice_settings_update on firm_invoice_settings
  for update using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'firm_invoice_settings'
                  and policyname not in ('firm_invoice_settings_insert', 'firm_invoice_settings_select', 'firm_invoice_settings_update') loop
      insert into _extras_dropped values ('public.firm_invoice_settings', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.firm_invoice_settings', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.firm_invoice_settings', sqlerrm);
end $sync$;

-- ═══ public.firm_links ═══ expected: firm_links_all (1410_firm_links.sql)
do $sync$
begin
  if to_regclass('public.firm_links') is null then
    insert into _skipped values ('public.firm_links', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.firm_links enable row level security';
  execute 'drop policy if exists "firm_links_all" on public.firm_links';
  execute $ddl$
create policy firm_links_all on firm_links for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'firm_links'
                  and policyname not in ('firm_links_all') loop
      insert into _extras_dropped values ('public.firm_links', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.firm_links', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.firm_links', sqlerrm);
end $sync$;

-- ═══ public.firm_roles ═══ expected: firm_roles_select (1260_firm_roles.sql)
do $sync$
begin
  if to_regclass('public.firm_roles') is null then
    insert into _skipped values ('public.firm_roles', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.firm_roles enable row level security';
  execute 'drop policy if exists "firm_roles_select" on public.firm_roles';
  execute $ddl$
create policy firm_roles_select on firm_roles for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'firm_roles'
                  and policyname not in ('firm_roles_select') loop
      insert into _extras_dropped values ('public.firm_roles', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.firm_roles', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.firm_roles', sqlerrm);
end $sync$;

-- ═══ public.firms ═══ expected: firms_select (0002_rls.sql), firms_update (0002_rls.sql)
do $sync$
begin
  if to_regclass('public.firms') is null then
    insert into _skipped values ('public.firms', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.firms enable row level security';
  execute 'drop policy if exists "firms_select" on public.firms';
  execute $ddl$
create policy firms_select on firms for select
  using (id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "firms_update" on public.firms';
  execute $ddl$
create policy firms_update on firms for update
  using (id = public.current_firm_id())
  with check (id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'firms'
                  and policyname not in ('firms_select', 'firms_update') loop
      insert into _extras_dropped values ('public.firms', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.firms', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.firms', sqlerrm);
end $sync$;

-- ═══ public.imported_documents ═══ expected: imported_documents_all (1090_document_soft_delete.sql)
do $sync$
begin
  if to_regclass('public.imported_documents') is null then
    insert into _skipped values ('public.imported_documents', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.imported_documents enable row level security';
  execute 'drop policy if exists "imported_documents_all" on public.imported_documents';
  execute $ddl$
create policy imported_documents_all on public.imported_documents for all
  using (
    deleted_at is null
    and firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or not public.client_is_private(client_id)
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'imported_documents'
                  and policyname not in ('imported_documents_all') loop
      insert into _extras_dropped values ('public.imported_documents', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.imported_documents', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.imported_documents', sqlerrm);
end $sync$;

-- ═══ public.invoice_payments ═══ expected: invoice_payments_all (1310_billing_section.sql)
do $sync$
begin
  if to_regclass('public.invoice_payments') is null then
    insert into _skipped values ('public.invoice_payments', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.invoice_payments enable row level security';
  execute 'drop policy if exists "invoice_payments_all" on public.invoice_payments';
  execute $ddl$
create policy invoice_payments_all on invoice_payments for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        (engagement_id is null or not public.engagement_is_private(engagement_id))
        and (client_id is null or not public.client_is_private(client_id))
      )
    )
  )
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'invoice_payments'
                  and policyname not in ('invoice_payments_all') loop
      insert into _extras_dropped values ('public.invoice_payments', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.invoice_payments', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.invoice_payments', sqlerrm);
end $sync$;

-- ═══ public.jobs ═══ deny-all by design: RLS on, ZERO policies (service-role access only)
do $sync$
begin
  if to_regclass('public.jobs') is null then
    insert into _skipped values ('public.jobs', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.jobs enable row level security';
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'jobs'
                   loop
      insert into _extras_dropped values ('public.jobs', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.jobs', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.jobs', sqlerrm);
end $sync$;

-- ═══ public.month_end_closes ═══ expected: month_end_closes_all (1201_month_end_closes.sql)
do $sync$
begin
  if to_regclass('public.month_end_closes') is null then
    insert into _skipped values ('public.month_end_closes', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.month_end_closes enable row level security';
  execute 'drop policy if exists "month_end_closes_all" on public.month_end_closes';
  execute $ddl$
create policy month_end_closes_all on month_end_closes for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'month_end_closes'
                  and policyname not in ('month_end_closes_all') loop
      insert into _extras_dropped values ('public.month_end_closes', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.month_end_closes', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.month_end_closes', sqlerrm);
end $sync$;

-- ═══ public.notification_mutes ═══ expected: notification_mutes_rw (0920_notifications.sql)
do $sync$
begin
  if to_regclass('public.notification_mutes') is null then
    insert into _skipped values ('public.notification_mutes', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.notification_mutes enable row level security';
  execute 'drop policy if exists "notification_mutes_rw" on public.notification_mutes';
  execute $ddl$
create policy notification_mutes_rw on notification_mutes
  for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'notification_mutes'
                  and policyname not in ('notification_mutes_rw') loop
      insert into _extras_dropped values ('public.notification_mutes', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.notification_mutes', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.notification_mutes', sqlerrm);
end $sync$;

-- ═══ public.notification_preferences ═══ expected: notification_preferences_rw (0920_notifications.sql)
do $sync$
begin
  if to_regclass('public.notification_preferences') is null then
    insert into _skipped values ('public.notification_preferences', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.notification_preferences enable row level security';
  execute 'drop policy if exists "notification_preferences_rw" on public.notification_preferences';
  execute $ddl$
create policy notification_preferences_rw on notification_preferences
  for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'notification_preferences'
                  and policyname not in ('notification_preferences_rw') loop
      insert into _extras_dropped values ('public.notification_preferences', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.notification_preferences', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.notification_preferences', sqlerrm);
end $sync$;

-- ═══ public.notification_settings ═══ expected: notification_settings_rw (0920_notifications.sql)
do $sync$
begin
  if to_regclass('public.notification_settings') is null then
    insert into _skipped values ('public.notification_settings', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.notification_settings enable row level security';
  execute 'drop policy if exists "notification_settings_rw" on public.notification_settings';
  execute $ddl$
create policy notification_settings_rw on notification_settings
  for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'notification_settings'
                  and policyname not in ('notification_settings_rw') loop
      insert into _extras_dropped values ('public.notification_settings', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.notification_settings', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.notification_settings', sqlerrm);
end $sync$;

-- ═══ public.notifications ═══ expected: notifications_select_own (0920_notifications.sql), notifications_update_own (0920_notifications.sql)
do $sync$
begin
  if to_regclass('public.notifications') is null then
    insert into _skipped values ('public.notifications', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.notifications enable row level security';
  execute 'drop policy if exists "notifications_select_own" on public.notifications';
  execute $ddl$
create policy notifications_select_own on notifications
  for select using (user_id = auth.uid())
$ddl$;
  execute 'drop policy if exists "notifications_update_own" on public.notifications';
  execute $ddl$
create policy notifications_update_own on notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'notifications'
                  and policyname not in ('notifications_select_own', 'notifications_update_own') loop
      insert into _extras_dropped values ('public.notifications', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.notifications', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.notifications', sqlerrm);
end $sync$;

-- ═══ public.organize_suggestions ═══ expected: organize_suggestions_all (1140_organize_suggestions.sql)
do $sync$
begin
  if to_regclass('public.organize_suggestions') is null then
    insert into _skipped values ('public.organize_suggestions', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.organize_suggestions enable row level security';
  execute 'drop policy if exists "organize_suggestions_all" on public.organize_suggestions';
  execute $ddl$
create policy organize_suggestions_all on organize_suggestions for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'organize_suggestions'
                  and policyname not in ('organize_suggestions_all') loop
      insert into _extras_dropped values ('public.organize_suggestions', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.organize_suggestions', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.organize_suggestions', sqlerrm);
end $sync$;

-- ═══ public.payment_requests ═══ expected: payment_requests_all (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.payment_requests') is null then
    insert into _skipped values ('public.payment_requests', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.payment_requests enable row level security';
  execute 'drop policy if exists "payment_requests_all" on public.payment_requests';
  execute $ddl$
create policy payment_requests_all on public.payment_requests for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        (engagement_id is null or not public.engagement_is_private(engagement_id))
        and (client_id is null or not public.client_is_private(client_id))
      )
    )
  )
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'payment_requests'
                  and policyname not in ('payment_requests_all') loop
      insert into _extras_dropped values ('public.payment_requests', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.payment_requests', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.payment_requests', sqlerrm);
end $sync$;

-- ═══ public.payout_journal_drafts ═══ expected: payout_journal_drafts_select (1010_payout_journal_drafts.sql)
do $sync$
begin
  if to_regclass('public.payout_journal_drafts') is null then
    insert into _skipped values ('public.payout_journal_drafts', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.payout_journal_drafts enable row level security';
  execute 'drop policy if exists "payout_journal_drafts_select" on public.payout_journal_drafts';
  execute $ddl$
create policy payout_journal_drafts_select on payout_journal_drafts for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'payout_journal_drafts'
                  and policyname not in ('payout_journal_drafts_select') loop
      insert into _extras_dropped values ('public.payout_journal_drafts', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.payout_journal_drafts', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.payout_journal_drafts', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_accounts ═══ expected: quickbooks_accounts_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_accounts') is null then
    insert into _skipped values ('public.quickbooks_accounts', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_accounts enable row level security';
  execute 'drop policy if exists "quickbooks_accounts_select" on public.quickbooks_accounts';
  execute $ddl$
create policy quickbooks_accounts_select on public.quickbooks_accounts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_accounts'
                  and policyname not in ('quickbooks_accounts_select') loop
      insert into _extras_dropped values ('public.quickbooks_accounts', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_accounts', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_accounts', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_connections ═══ expected: quickbooks_connections_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_connections') is null then
    insert into _skipped values ('public.quickbooks_connections', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_connections enable row level security';
  execute 'drop policy if exists "quickbooks_connections_select" on public.quickbooks_connections';
  execute $ddl$
create policy quickbooks_connections_select on public.quickbooks_connections for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_connections'
                  and policyname not in ('quickbooks_connections_select') loop
      insert into _extras_dropped values ('public.quickbooks_connections', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_connections', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_connections', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_customers ═══ expected: quickbooks_customers_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_customers') is null then
    insert into _skipped values ('public.quickbooks_customers', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_customers enable row level security';
  execute 'drop policy if exists "quickbooks_customers_select" on public.quickbooks_customers';
  execute $ddl$
create policy quickbooks_customers_select on public.quickbooks_customers for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_customers'
                  and policyname not in ('quickbooks_customers_select') loop
      insert into _extras_dropped values ('public.quickbooks_customers', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_customers', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_customers', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_items ═══ expected: quickbooks_items_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_items') is null then
    insert into _skipped values ('public.quickbooks_items', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_items enable row level security';
  execute 'drop policy if exists "quickbooks_items_select" on public.quickbooks_items';
  execute $ddl$
create policy quickbooks_items_select on public.quickbooks_items for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_items'
                  and policyname not in ('quickbooks_items_select') loop
      insert into _extras_dropped values ('public.quickbooks_items', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_items', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_items', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_learned_mappings ═══ expected: qbo_learned_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_learned_mappings') is null then
    insert into _skipped values ('public.quickbooks_learned_mappings', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_learned_mappings enable row level security';
  execute 'drop policy if exists "qbo_learned_select" on public.quickbooks_learned_mappings';
  execute $ddl$
create policy qbo_learned_select on public.quickbooks_learned_mappings for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_learned_mappings'
                  and policyname not in ('qbo_learned_select') loop
      insert into _extras_dropped values ('public.quickbooks_learned_mappings', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_learned_mappings', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_learned_mappings', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_tax_codes ═══ expected: quickbooks_tax_codes_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_tax_codes') is null then
    insert into _skipped values ('public.quickbooks_tax_codes', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_tax_codes enable row level security';
  execute 'drop policy if exists "quickbooks_tax_codes_select" on public.quickbooks_tax_codes';
  execute $ddl$
create policy quickbooks_tax_codes_select on public.quickbooks_tax_codes for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_tax_codes'
                  and policyname not in ('quickbooks_tax_codes_select') loop
      insert into _extras_dropped values ('public.quickbooks_tax_codes', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_tax_codes', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_tax_codes', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_transaction_suggestions ═══ expected: qbo_tx_suggestions_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_transaction_suggestions') is null then
    insert into _skipped values ('public.quickbooks_transaction_suggestions', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_transaction_suggestions enable row level security';
  execute 'drop policy if exists "qbo_tx_suggestions_select" on public.quickbooks_transaction_suggestions';
  execute $ddl$
create policy qbo_tx_suggestions_select on public.quickbooks_transaction_suggestions
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_transaction_suggestions'
                  and policyname not in ('qbo_tx_suggestions_select') loop
      insert into _extras_dropped values ('public.quickbooks_transaction_suggestions', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_transaction_suggestions', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_transaction_suggestions', sqlerrm);
end $sync$;

-- ═══ public.quickbooks_vendors ═══ expected: quickbooks_vendors_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.quickbooks_vendors') is null then
    insert into _skipped values ('public.quickbooks_vendors', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.quickbooks_vendors enable row level security';
  execute 'drop policy if exists "quickbooks_vendors_select" on public.quickbooks_vendors';
  execute $ddl$
create policy quickbooks_vendors_select on public.quickbooks_vendors for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'quickbooks_vendors'
                  and policyname not in ('quickbooks_vendors_select') loop
      insert into _extras_dropped values ('public.quickbooks_vendors', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.quickbooks_vendors', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.quickbooks_vendors', sqlerrm);
end $sync$;

-- ═══ public.recurring_occurrences ═══ expected: recurring_occurrences_insert (0770_recurring_series.sql), recurring_occurrences_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.recurring_occurrences') is null then
    insert into _skipped values ('public.recurring_occurrences', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.recurring_occurrences enable row level security';
  execute 'drop policy if exists "recurring_occurrences_insert" on public.recurring_occurrences';
  execute $ddl$
create policy recurring_occurrences_insert on recurring_occurrences
  for insert with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from recurring_series s
      where s.id = series_id
        and s.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  execute 'drop policy if exists "recurring_occurrences_select" on public.recurring_occurrences';
  execute $ddl$
create policy recurring_occurrences_select on public.recurring_occurrences
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.series_is_private(series_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'recurring_occurrences'
                  and policyname not in ('recurring_occurrences_insert', 'recurring_occurrences_select') loop
      insert into _extras_dropped values ('public.recurring_occurrences', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.recurring_occurrences', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.recurring_occurrences', sqlerrm);
end $sync$;

-- ═══ public.recurring_series ═══ expected: recurring_series_insert (0770_recurring_series.sql), recurring_series_select (0960_recurring_series_privacy.sql), recurring_series_update (0960_recurring_series_privacy.sql)
do $sync$
begin
  if to_regclass('public.recurring_series') is null then
    insert into _skipped values ('public.recurring_series', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.recurring_series enable row level security';
  execute 'drop policy if exists "recurring_series_insert" on public.recurring_series';
  execute $ddl$
create policy recurring_series_insert on recurring_series
  for insert with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from clients c
      where c.id = client_id
        and c.firm_id = public.current_firm_id()
    )
    and (
      source_engagement_id is null
      or exists (
        select 1 from engagements e
        where e.id = source_engagement_id
          and e.firm_id = public.current_firm_id()
      )
    )
  )
$ddl$;
  execute 'drop policy if exists "recurring_series_select" on public.recurring_series';
  execute $ddl$
create policy recurring_series_select on public.recurring_series
  for select using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and not public.engagement_is_private(source_engagement_id)
      )
    )
  )
$ddl$;
  execute $ddl$
comment on policy recurring_series_select on public.recurring_series is
  'Firm-scoped. Staff additionally cannot see a series whose CLIENT is private (0810) or whose SOURCE ENGAGEMENT is private (0850/0960) — the latter matters because the series copies the engagement title verbatim.'
$ddl$;
  execute 'drop policy if exists "recurring_series_update" on public.recurring_series';
  execute $ddl$
create policy recurring_series_update on public.recurring_series
  for update using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and not public.engagement_is_private(source_engagement_id)
      )
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and not public.engagement_is_private(source_engagement_id)
      )
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'recurring_series'
                  and policyname not in ('recurring_series_insert', 'recurring_series_select', 'recurring_series_update') loop
      insert into _extras_dropped values ('public.recurring_series', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.recurring_series', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.recurring_series', sqlerrm);
end $sync$;

-- ═══ public.reminders ═══ expected: reminders_all (0002_rls.sql)
do $sync$
begin
  if to_regclass('public.reminders') is null then
    insert into _skipped values ('public.reminders', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.reminders enable row level security';
  execute 'drop policy if exists "reminders_all" on public.reminders';
  execute $ddl$
create policy reminders_all on reminders for all
  using (
    exists (
      select 1 from engagements e
      where e.id = reminders.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = reminders.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'reminders'
                  and policyname not in ('reminders_all') loop
      insert into _extras_dropped values ('public.reminders', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.reminders', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.reminders', sqlerrm);
end $sync$;

-- ═══ public.request_items ═══ expected: request_items_all (0002_rls.sql)
do $sync$
begin
  if to_regclass('public.request_items') is null then
    insert into _skipped values ('public.request_items', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.request_items enable row level security';
  execute 'drop policy if exists "request_items_all" on public.request_items';
  execute $ddl$
create policy request_items_all on request_items for all
  using (
    exists (
      select 1 from engagements e
      where e.id = request_items.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = request_items.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'request_items'
                  and policyname not in ('request_items_all') loop
      insert into _extras_dropped values ('public.request_items', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.request_items', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.request_items', sqlerrm);
end $sync$;

-- ═══ public.signature_requests ═══ expected: signature_requests_all (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.signature_requests') is null then
    insert into _skipped values ('public.signature_requests', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.signature_requests enable row level security';
  execute 'drop policy if exists "signature_requests_all" on public.signature_requests';
  execute $ddl$
create policy signature_requests_all on public.signature_requests for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'signature_requests'
                  and policyname not in ('signature_requests_all') loop
      insert into _extras_dropped values ('public.signature_requests', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.signature_requests', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.signature_requests', sqlerrm);
end $sync$;

-- ═══ public.storage_connections ═══ expected: storage_connections_select (0900_filing_engine.sql)
do $sync$
begin
  if to_regclass('public.storage_connections') is null then
    insert into _skipped values ('public.storage_connections', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.storage_connections enable row level security';
  execute 'drop policy if exists "storage_connections_select" on public.storage_connections';
  execute $ddl$
create policy storage_connections_select on storage_connections for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'storage_connections'
                  and policyname not in ('storage_connections_select') loop
      insert into _extras_dropped values ('public.storage_connections', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.storage_connections', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.storage_connections', sqlerrm);
end $sync$;

-- ═══ public.task_statuses ═══ expected: task_statuses_select (1420_firm_task_statuses.sql), task_statuses_write (1420_firm_task_statuses.sql)
do $sync$
begin
  if to_regclass('public.task_statuses') is null then
    insert into _skipped values ('public.task_statuses', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.task_statuses enable row level security';
  execute 'drop policy if exists "task_statuses_select" on public.task_statuses';
  execute $ddl$
create policy task_statuses_select on public.task_statuses for select
  using (firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "task_statuses_write" on public.task_statuses';
  execute $ddl$
create policy task_statuses_write on public.task_statuses for all
  using (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from public.users u
       where u.id = auth.uid() and u.role = 'owner'
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from public.users u
       where u.id = auth.uid() and u.role = 'owner'
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'task_statuses'
                  and policyname not in ('task_statuses_select', 'task_statuses_write') loop
      insert into _extras_dropped values ('public.task_statuses', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.task_statuses', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.task_statuses', sqlerrm);
end $sync$;

-- ═══ public.team_message_reads ═══ expected: team_message_reads_rw (0870_team_messages.sql)
do $sync$
begin
  if to_regclass('public.team_message_reads') is null then
    insert into _skipped values ('public.team_message_reads', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.team_message_reads enable row level security';
  execute 'drop policy if exists "team_message_reads_rw" on public.team_message_reads';
  execute $ddl$
create policy team_message_reads_rw on team_message_reads
  for all
  using (firm_id = public.current_firm_id() and user_id = auth.uid())
  with check (firm_id = public.current_firm_id() and user_id = auth.uid())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'team_message_reads'
                  and policyname not in ('team_message_reads_rw') loop
      insert into _extras_dropped values ('public.team_message_reads', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.team_message_reads', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.team_message_reads', sqlerrm);
end $sync$;

-- ═══ public.team_messages ═══ expected: team_messages_delete (0870_team_messages.sql), team_messages_insert (0870_team_messages.sql), team_messages_select (0870_team_messages.sql)
do $sync$
begin
  if to_regclass('public.team_messages') is null then
    insert into _skipped values ('public.team_messages', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.team_messages enable row level security';
  execute 'drop policy if exists "team_messages_delete" on public.team_messages';
  execute $ddl$
create policy team_messages_delete on team_messages
  for delete using (
    firm_id = public.current_firm_id()
    and sender_user_id = auth.uid()
  )
$ddl$;
  execute 'drop policy if exists "team_messages_insert" on public.team_messages';
  execute $ddl$
create policy team_messages_insert on team_messages
  for insert with check (
    firm_id = public.current_firm_id()
    and sender_user_id = auth.uid()
  )
$ddl$;
  execute 'drop policy if exists "team_messages_select" on public.team_messages';
  execute $ddl$
create policy team_messages_select on team_messages
  for select using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'team_messages'
                  and policyname not in ('team_messages_delete', 'team_messages_insert', 'team_messages_select') loop
      insert into _extras_dropped values ('public.team_messages', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.team_messages', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.team_messages', sqlerrm);
end $sync$;

-- ═══ public.templates ═══ expected: templates_select (0002_rls.sql), templates_write (0002_rls.sql)
do $sync$
begin
  if to_regclass('public.templates') is null then
    insert into _skipped values ('public.templates', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.templates enable row level security';
  execute 'drop policy if exists "templates_select" on public.templates';
  execute $ddl$
create policy templates_select on templates for select
  using (firm_id is null or firm_id = public.current_firm_id())
$ddl$;
  execute 'drop policy if exists "templates_write" on public.templates';
  execute $ddl$
create policy templates_write on templates for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'templates'
                  and policyname not in ('templates_select', 'templates_write') loop
      insert into _extras_dropped values ('public.templates', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.templates', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.templates', sqlerrm);
end $sync$;

-- ═══ public.uploaded_files ═══ expected: uploaded_files_all (1090_document_soft_delete.sql)
do $sync$
begin
  if to_regclass('public.uploaded_files') is null then
    insert into _skipped values ('public.uploaded_files', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.uploaded_files enable row level security';
  execute 'drop policy if exists "uploaded_files_all" on public.uploaded_files';
  execute $ddl$
create policy uploaded_files_all on public.uploaded_files for all
  using (
    deleted_at is null
    and exists (
      select 1 from public.engagements e
      where e.id = uploaded_files.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1 from public.engagements e
      where e.id = uploaded_files.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'uploaded_files'
                  and policyname not in ('uploaded_files_all') loop
      insert into _extras_dropped values ('public.uploaded_files', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.uploaded_files', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.uploaded_files', sqlerrm);
end $sync$;

-- ═══ public.user_firm_roles ═══ expected: user_firm_roles_select (1260_firm_roles.sql)
do $sync$
begin
  if to_regclass('public.user_firm_roles') is null then
    insert into _skipped values ('public.user_firm_roles', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.user_firm_roles enable row level security';
  execute 'drop policy if exists "user_firm_roles_select" on public.user_firm_roles';
  execute $ddl$
create policy user_firm_roles_select on user_firm_roles for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'user_firm_roles'
                  and policyname not in ('user_firm_roles_select') loop
      insert into _extras_dropped values ('public.user_firm_roles', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.user_firm_roles', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.user_firm_roles', sqlerrm);
end $sync$;

-- ═══ public.user_mfa_recovery_codes ═══ expected: user_mfa_recovery_codes_select_self (0079_user_mfa_recovery_codes.sql)
do $sync$
begin
  if to_regclass('public.user_mfa_recovery_codes') is null then
    insert into _skipped values ('public.user_mfa_recovery_codes', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.user_mfa_recovery_codes enable row level security';
  execute 'drop policy if exists "user_mfa_recovery_codes_select_self" on public.user_mfa_recovery_codes';
  execute $ddl$
create policy user_mfa_recovery_codes_select_self
  on user_mfa_recovery_codes
  for select to authenticated
  using (user_id = auth.uid())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'user_mfa_recovery_codes'
                  and policyname not in ('user_mfa_recovery_codes_select_self') loop
      insert into _extras_dropped values ('public.user_mfa_recovery_codes', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.user_mfa_recovery_codes', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.user_mfa_recovery_codes', sqlerrm);
end $sync$;

-- ═══ public.users ═══ expected: users_select (1300_outside_collaborators.sql), users_update_self (0019_user_profile.sql)
do $sync$
begin
  if to_regclass('public.users') is null then
    insert into _skipped values ('public.users', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.users enable row level security';
  execute 'drop policy if exists "users_select" on public.users';
  execute $ddl$
create policy users_select on public.users for select
  using (
    firm_id = public.current_firm_id()
    and (
      not public.current_user_is_external()
      or id = auth.uid()
      or role = 'owner'
      or public.shares_a_client_with_me(id)
    )
  )
$ddl$;
  execute $ddl$
comment on policy users_select on public.users is
  'Firm-scoped. A normal member sees the whole roster. An OUTSIDE COLLABORATOR (users.is_external, 1300) sees only themselves, the firm''s owners, and people they share a client with.'
$ddl$;
  execute 'drop policy if exists "users_update_self" on public.users';
  execute $ddl$
create policy users_update_self on users
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'users'
                  and policyname not in ('users_select', 'users_update_self') loop
      insert into _extras_dropped values ('public.users', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.users', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.users', sqlerrm);
end $sync$;

-- ═══ public.xero_accounts ═══ expected: xero_accounts_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.xero_accounts') is null then
    insert into _skipped values ('public.xero_accounts', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.xero_accounts enable row level security';
  execute 'drop policy if exists "xero_accounts_select" on public.xero_accounts';
  execute $ddl$
create policy xero_accounts_select on public.xero_accounts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'xero_accounts'
                  and policyname not in ('xero_accounts_select') loop
      insert into _extras_dropped values ('public.xero_accounts', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.xero_accounts', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.xero_accounts', sqlerrm);
end $sync$;

-- ═══ public.xero_connections ═══ expected: xero_connections_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.xero_connections') is null then
    insert into _skipped values ('public.xero_connections', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.xero_connections enable row level security';
  execute 'drop policy if exists "xero_connections_select" on public.xero_connections';
  execute $ddl$
create policy xero_connections_select on public.xero_connections for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'xero_connections'
                  and policyname not in ('xero_connections_select') loop
      insert into _extras_dropped values ('public.xero_connections', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.xero_connections', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.xero_connections', sqlerrm);
end $sync$;

-- ═══ public.xero_contacts ═══ expected: xero_contacts_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.xero_contacts') is null then
    insert into _skipped values ('public.xero_contacts', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.xero_contacts enable row level security';
  execute 'drop policy if exists "xero_contacts_select" on public.xero_contacts';
  execute $ddl$
create policy xero_contacts_select on public.xero_contacts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'xero_contacts'
                  and policyname not in ('xero_contacts_select') loop
      insert into _extras_dropped values ('public.xero_contacts', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.xero_contacts', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.xero_contacts', sqlerrm);
end $sync$;

-- ═══ public.xero_items ═══ expected: xero_items_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.xero_items') is null then
    insert into _skipped values ('public.xero_items', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.xero_items enable row level security';
  execute 'drop policy if exists "xero_items_select" on public.xero_items';
  execute $ddl$
create policy xero_items_select on public.xero_items for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'xero_items'
                  and policyname not in ('xero_items_select') loop
      insert into _extras_dropped values ('public.xero_items', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.xero_items', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.xero_items', sqlerrm);
end $sync$;

-- ═══ public.xero_tax_rates ═══ expected: xero_tax_rates_select (0810_client_private.sql)
do $sync$
begin
  if to_regclass('public.xero_tax_rates') is null then
    insert into _skipped values ('public.xero_tax_rates', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.xero_tax_rates enable row level security';
  execute 'drop policy if exists "xero_tax_rates_select" on public.xero_tax_rates';
  execute $ddl$
create policy xero_tax_rates_select on public.xero_tax_rates for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'xero_tax_rates'
                  and policyname not in ('xero_tax_rates_select') loop
      insert into _extras_dropped values ('public.xero_tax_rates', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.xero_tax_rates', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.xero_tax_rates', sqlerrm);
end $sync$;

-- ═══ public.xero_tracking_options ═══ expected: xero_tracking_options_select (1020_xero_tracking.sql)
do $sync$
begin
  if to_regclass('public.xero_tracking_options') is null then
    insert into _skipped values ('public.xero_tracking_options', 'table does not exist — a pending migration creates it; run db push, then re-run this file');
    return;
  end if;
  execute 'alter table public.xero_tracking_options enable row level security';
  execute 'drop policy if exists "xero_tracking_options_select" on public.xero_tracking_options';
  execute $ddl$
create policy xero_tracking_options_select on xero_tracking_options for select
  using (firm_id = public.current_firm_id())
$ddl$;
  -- anything else on this table is not in the repo: record it, drop it
  declare rec record;
  begin
    for rec in select policyname, cmd, array_to_string(roles, ',') as roles, qual, with_check
                 from pg_policies where schemaname = 'public' and tablename = 'xero_tracking_options'
                  and policyname not in ('xero_tracking_options_select') loop
      insert into _extras_dropped values ('public.xero_tracking_options', rec.policyname, rec.cmd, rec.roles, rec.qual, rec.with_check);
      execute format('drop policy %I on public.xero_tracking_options', rec.policyname);
    end loop;
  end;
exception when others then
  insert into _skipped values ('public.xero_tracking_options', sqlerrm);
end $sync$;

-- ═══ storage.objects ═══ platform-owned table: canon policy re-asserted, extras only REPORTED
do $sync$
begin
  execute 'drop policy if exists "firm members read own uploads" on storage.objects';
  execute $ddl$
create policy "firm members read own uploads"
on storage.objects for select to authenticated
using (
  bucket_id = 'client-uploads'
  and (storage.foldername(name))[1] = 'firms'
  and (storage.foldername(name))[2]::uuid = public.current_firm_id()
)
$ddl$;
exception when others then
  insert into _skipped values ('storage.objects', sqlerrm);
end $sync$;

-- ── 3. THE REPORT — this is the output to send back ──────────────────────
with canon(tbl, pol) as (values
  ('public.firms', 'firms_select'),
  ('public.firms', 'firms_update'),
  ('public.users', 'users_select'),
  ('public.users', 'users_update_self'),
  ('public.clients', 'clients_all'),
  ('public.engagements', 'engagements_all'),
  ('public.request_items', 'request_items_all'),
  ('public.uploaded_files', 'uploaded_files_all'),
  ('public.reminders', 'reminders_all'),
  ('public.templates', 'templates_select'),
  ('public.templates', 'templates_write'),
  ('public.activity_log', 'activity_log_select'),
  ('public.activity_log', 'activity_log_insert'),
  ('storage.objects', 'firm members read own uploads'),
  ('public.feedback', 'feedback_insert'),
  ('public.feedback', 'feedback_select'),
  ('public.ai_rejection_overrides', 'ai_rejection_overrides_all'),
  ('public.user_mfa_recovery_codes', 'user_mfa_recovery_codes_select_self'),
  ('public.firm_invites', 'firm_invites_select_owner'),
  ('public.ai_usage_monthly', 'ai_usage_monthly_select'),
  ('public.payment_requests', 'payment_requests_all'),
  ('public.signature_requests', 'signature_requests_all'),
  ('public.quickbooks_connections', 'quickbooks_connections_select'),
  ('public.quickbooks_accounts', 'quickbooks_accounts_select'),
  ('public.quickbooks_vendors', 'quickbooks_vendors_select'),
  ('public.quickbooks_customers', 'quickbooks_customers_select'),
  ('public.quickbooks_tax_codes', 'quickbooks_tax_codes_select'),
  ('public.quickbooks_transaction_suggestions', 'qbo_tx_suggestions_select'),
  ('public.quickbooks_items', 'quickbooks_items_select'),
  ('public.quickbooks_learned_mappings', 'qbo_learned_select'),
  ('public.chat_conversations', 'chat_conversations_select'),
  ('public.chat_conversations', 'chat_conversations_insert'),
  ('public.chat_messages', 'chat_messages_select'),
  ('public.chat_messages', 'chat_messages_insert'),
  ('public.chat_pending_actions', 'chat_pending_actions_select'),
  ('public.final_documents', 'final_documents_all'),
  ('public.client_message_threads', 'client_message_threads_select'),
  ('public.client_message_threads', 'client_message_threads_insert'),
  ('public.client_message_threads', 'client_message_threads_update'),
  ('public.client_messages', 'client_messages_select'),
  ('public.client_messages', 'client_messages_insert'),
  ('public.xero_connections', 'xero_connections_select'),
  ('public.client_import_sessions', 'client_import_sessions_select'),
  ('public.firm_invoice_settings', 'firm_invoice_settings_select'),
  ('public.firm_invoice_settings', 'firm_invoice_settings_insert'),
  ('public.firm_invoice_settings', 'firm_invoice_settings_update'),
  ('public.recurring_series', 'recurring_series_select'),
  ('public.recurring_series', 'recurring_series_insert'),
  ('public.recurring_series', 'recurring_series_update'),
  ('public.recurring_occurrences', 'recurring_occurrences_select'),
  ('public.recurring_occurrences', 'recurring_occurrences_insert'),
  ('public.xero_accounts', 'xero_accounts_select'),
  ('public.xero_contacts', 'xero_contacts_select'),
  ('public.xero_tax_rates', 'xero_tax_rates_select'),
  ('public.xero_items', 'xero_items_select'),
  ('public.file_comments', 'file_comments_select'),
  ('public.file_comments', 'file_comments_insert'),
  ('public.file_comments', 'file_comments_delete'),
  ('public.team_messages', 'team_messages_select'),
  ('public.team_messages', 'team_messages_insert'),
  ('public.team_messages', 'team_messages_delete'),
  ('public.team_message_reads', 'team_message_reads_rw'),
  ('public.storage_connections', 'storage_connections_select'),
  ('public.firm_filing_settings', 'firm_filing_settings_select'),
  ('public.firm_filing_settings', 'firm_filing_settings_insert'),
  ('public.firm_filing_settings', 'firm_filing_settings_update'),
  ('public.filing_runs', 'filing_runs_select'),
  ('public.filed_documents', 'filed_documents_select'),
  ('public.notifications', 'notifications_select_own'),
  ('public.notifications', 'notifications_update_own'),
  ('public.notification_preferences', 'notification_preferences_rw'),
  ('public.notification_settings', 'notification_settings_rw'),
  ('public.notification_mutes', 'notification_mutes_rw'),
  ('public.payout_journal_drafts', 'payout_journal_drafts_select'),
  ('public.xero_tracking_options', 'xero_tracking_options_select'),
  ('public.document_import_runs', 'document_import_runs_select'),
  ('public.imported_documents', 'imported_documents_all'),
  ('public.document_folders', 'document_folders_all'),
  ('public.organize_suggestions', 'organize_suggestions_all'),
  ('public.client_relationships', 'client_relationships_all'),
  ('public.document_texts', 'document_texts_select'),
  ('public.month_end_closes', 'month_end_closes_all'),
  ('public.client_members', 'client_members_all'),
  ('public.bank_statement_balances', 'bank_statement_balances_all'),
  ('public.firm_roles', 'firm_roles_select'),
  ('public.user_firm_roles', 'user_firm_roles_select'),
  ('public.client_notes', 'client_notes_select'),
  ('public.client_notes', 'client_notes_insert'),
  ('public.client_notes', 'client_notes_delete'),
  ('public.invoice_payments', 'invoice_payments_all'),
  ('public.engagement_members', 'engagement_members_select'),
  ('public.engagement_tasks', 'engagement_tasks_all'),
  ('public.engagement_task_assignees', 'engagement_task_assignees_all'),
  ('public.firm_links', 'firm_links_all'),
  ('public.task_statuses', 'task_statuses_select'),
  ('public.task_statuses', 'task_statuses_write')
),
after as (
  select schemaname||'.'||tablename as tbl, policyname as pol, cmd, permissive,
         array_to_string(roles, ',') as roles, qual, with_check
    from pg_policies where schemaname in ('public','storage')
),
fns_after as (
  select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('client_assigned_to_me','client_has_member','client_is_private','conversation_is_private','current_firm_allows_member_invites','current_firm_id','current_user_is_external','current_user_is_owner','engagement_has_member','engagement_is_private','on_an_engagement_for_client','series_is_private','shares_a_client_with_me')
),
lines as (
  select case when a.pol is null then 0 else 2 end as sev, c.tbl, c.pol as item,
         case
           when a.pol is null then 'STILL MISSING — see SKIPPED row for this table'
           when b.pol is null then 'CREATED (prod was missing this policy)'
           when (b.qual is distinct from a.qual) or (b.with_check is distinct from a.with_check)
                or b.cmd is distinct from a.cmd or b.roles is distinct from a.roles
                or b.permissive is distinct from a.permissive
             then 'FIXED — prod had drifted (old md5 '||md5(coalesce(b.qual,'')||'|'||coalesce(b.with_check,''))||')'
           else 'ok — already matched the repo'
         end as status,
         case when b.pol is not null and (b.qual is distinct from a.qual or b.with_check is distinct from a.with_check)
              then 'old USING: '||left(coalesce(b.qual,'—'),160) else '' end as detail
    from canon c
    left join after a on a.tbl = c.tbl and a.pol = c.pol
    left join _rls_before b on b.tbl = c.tbl and b.pol = c.pol
  union all
  select 1, tbl, pol, 'DROPPED extra policy (not in repo) — was '||cmd||' to '||coalesce(roles,'?')||', md5 '||md5(coalesce(qual,'')||'|'||coalesce(with_check,'')),
         'was USING: '||left(coalesce(qual,'—'),160)
    from _extras_dropped
  union all
  select 0, tbl, '—', 'SKIPPED: '||reason, '' from _skipped
  union all
  select 1, 'storage.objects', pol, 'REVIEW — extra storage policy left untouched (repo does not define it)', left(coalesce(qual, with_check),160)
    from after where tbl = 'storage.objects' and pol not in ('firm members read own uploads')
  union all
  select 2, 'function', f.proname,
         case when b.def is null then 'function CREATED (was missing)'
              when b.def <> f.def then 'function REPLACED — body differed (old md5 '||md5(b.def)||')'
              else 'function ok — already matched' end, ''
    from fns_after f left join _fns_before b on b.proname = f.proname
)
select * from (
  select -1 as sev, 'REPORT' as tbl,
         to_char(now(), 'YYYY-MM-DD HH24:MI') as item,
         (select count(*) filter (where status like 'FIXED%') from lines)||' fixed, '||
         (select count(*) filter (where status like 'CREATED%') from lines)||' created, '||
         (select count(*) filter (where status like 'DROPPED%') from lines)||' extras dropped, '||
         (select count(*) filter (where status like 'function REPLACED%' or status like 'function CREATED%') from lines)||' functions changed, '||
         (select count(*) filter (where status like 'ok%' or status like 'function ok%') from lines)||' already ok, '||
         (select count(*) filter (where status like 'SKIPPED%') from lines)||' skipped' as status,
         'send this whole table back' as detail
  union all
  select sev, tbl, item, status, detail from lines
) rep
order by sev, tbl, item;
