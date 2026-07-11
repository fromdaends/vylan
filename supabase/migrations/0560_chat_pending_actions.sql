-- Engagement chat pending actions (Assistant panel, phase 3).
--
-- The propose-and-confirm ledger. When the chat model proposes an action
-- (approve/reject a document, send a reminder, edit the checklist, change
-- the due date or assignee), the message endpoint writes ONE row here and
-- shows the accountant a confirm card. NOTHING executes until a human posts
-- the row's single-use token to /api/engagement-chat/confirm — the model
-- never sees the token and has no way to call the endpoint, so the AI is
-- architecturally unable to execute a side effect on its own.
--
-- Writes are SERVICE-ROLE ONLY (like the jobs table): no INSERT/UPDATE
-- grants for authenticated means the payload of a pending action can never
-- be tampered with through PostgREST between proposal and confirmation.
-- Reads are firm-scoped via RLS, with a COLUMN-LIMITED grant that excludes
-- `token` — the token travels only through the chat stream and (for still-
-- pending cards after a reload) the history endpoint, which re-authorizes
-- first and reads via the service role.
--
-- GATED: the chat code treats a missing table as "actions not activated
-- yet" and keeps answering questions normally, so this ships before the SQL
-- is applied — same tiered pattern as 0550.
--
-- Additive + reversible (down: drop chat_pending_actions).

create table if not exists chat_pending_actions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  -- Who asked the assistant (the proposer). Any active firm member may
  -- confirm — the same people who could do the action by hand — and the
  -- confirmer is recorded separately in confirmed_by.
  user_id uuid not null references users(id) on delete cascade,
  action_type text not null,
  -- The exact, validated action payload plus the human-facing snapshot the
  -- confirm card renders (file names, item labels, current values).
  payload jsonb not null,
  -- Single-use confirmation capability. Never exposed to authenticated
  -- PostgREST reads (excluded from the column grant below).
  token text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'confirming', 'confirmed', 'cancelled', 'failed', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  -- Machine-readable failure code when status = 'failed'.
  error text
);
create index if not exists chat_pending_actions_conversation_idx
  on chat_pending_actions (conversation_id, created_at);
create index if not exists chat_pending_actions_firm_idx
  on chat_pending_actions (firm_id);

alter table chat_pending_actions enable row level security;
drop policy if exists chat_pending_actions_select on chat_pending_actions;
create policy chat_pending_actions_select on chat_pending_actions for select
  using (firm_id = public.current_firm_id());
revoke all on chat_pending_actions from anon, authenticated;
-- Column-limited: everything EXCEPT token. No write grants at all —
-- inserts/updates happen through the service role after the route has
-- authenticated + authorized the caller.
grant select (
  id, firm_id, engagement_id, conversation_id, user_id, action_type,
  payload, status, expires_at, created_at, confirmed_by, resolved_at, error
) on chat_pending_actions to authenticated;
