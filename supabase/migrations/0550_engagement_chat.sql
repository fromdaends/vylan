-- Engagement chat (Assistant panel, phase 2).
--
-- One persistent conversation PER ENGAGEMENT, shared by the whole firm (like
-- the activity feed): chat_conversations is the engagement<->thread anchor,
-- chat_messages is the append-only transcript. The transcript doubles as the
-- SERVER-SIDE rate-limit ledger: the chat endpoint counts a user's `user`
-- rows inside the rolling window (CHAT_WINDOW_HOURS) before every model call,
-- so the 30-messages-per-36h limit cannot be dodged client-side.
--
-- GATED: the chat code detects a missing table (isChatSchemaMissing) and
-- degrades to a polite "not activated yet" state, so this file can ship in
-- the PR and be applied to prod on its own schedule — same tiered pattern as
-- the QuickBooks migrations (0450+).
--
-- Additive + reversible (down: drop chat_messages, then chat_conversations).

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- ONE conversation per engagement; the route get-or-creates on first send.
  unique (engagement_id)
);
create index if not exists chat_conversations_firm_idx
  on chat_conversations (firm_id);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  -- Author of a `user` turn; null for `assistant` turns. SET NULL keeps the
  -- transcript readable after a teammate is deleted.
  user_id uuid references users(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conversation_idx
  on chat_messages (conversation_id, created_at);
-- The rolling-window rate-limit count: my `user` turns since now() - window.
create index if not exists chat_messages_user_window_idx
  on chat_messages (user_id, created_at desc)
  where role = 'user';

-- RLS + grants, following the repo's table-grant hardening pattern (0190 /
-- 0230 / 0430): revoke the default PostgREST grants, re-grant only what the
-- app needs to `authenticated` (anon gets nothing), then firm-scope every
-- path with policies.
--
-- Reads: any firm member can read their firm's conversations (the thread is
-- shared, like activity). Writes: INSERT only — the transcript is an
-- append-only log; no UPDATE/DELETE policies means edits/deletions are
-- denied outright. A `user` row must be authored as yourself; an `assistant`
-- row must be anonymous (user_id null), so a member cannot forge a turn as a
-- teammate.

alter table chat_conversations enable row level security;
drop policy if exists chat_conversations_select on chat_conversations;
create policy chat_conversations_select on chat_conversations for select
  using (firm_id = public.current_firm_id());
drop policy if exists chat_conversations_insert on chat_conversations;
create policy chat_conversations_insert on chat_conversations for insert
  with check (firm_id = public.current_firm_id());
revoke all on chat_conversations from anon, authenticated;
grant select, insert on chat_conversations to authenticated;

alter table chat_messages enable row level security;
drop policy if exists chat_messages_select on chat_messages;
create policy chat_messages_select on chat_messages for select
  using (firm_id = public.current_firm_id());
drop policy if exists chat_messages_insert on chat_messages;
create policy chat_messages_insert on chat_messages for insert
  with check (
    firm_id = public.current_firm_id()
    and (
      (role = 'user' and user_id = auth.uid())
      or (role = 'assistant' and user_id is null)
    )
  );
revoke all on chat_messages from anon, authenticated;
grant select, insert on chat_messages to authenticated;
