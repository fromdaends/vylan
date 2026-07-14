-- Client messaging (Phase 1): a per-engagement text thread between the firm
-- and the client. TEXT ONLY by design — documents must flow through the
-- checklist so the AI pipeline checks them; this table deliberately has no
-- attachment columns. Entirely separate from the AI assistant chat
-- (chat_conversations / chat_messages, 0550): different tables, different
-- components, zero crossover.
--
-- Trust model (two directions):
--   * Firm members read/write through the RLS-scoped session client — the
--     policies below enforce firm isolation and self-authorship.
--   * The client NEVER touches these tables directly: the portal's
--     /api/portal/messages routes validate the magic token, resolve it to
--     exactly one engagement, and read/write via the service role (which
--     bypasses RLS) — the same model as portal uploads. `anon` gets nothing.
--
-- GATED: the code detects a missing table (isClientMessagingSchemaMissing)
-- and degrades to a quiet "not activated yet" state, so this file can ship
-- in the PR and be applied to prod on its own schedule — the repo's tiered
-- pattern (0450+/0550).
--
-- Additive + reversible (down: drop client_messages, then
-- client_message_threads).

-- One row per engagement holding the thread's READ + NOTIFY state. Created
-- lazily on first message. The three timestamps power the unread badges and
-- the debounced client email (Phase 3):
--   firm_last_read_at      — when a firm member last opened the thread
--   client_last_read_at    — when the client last opened the thread (portal,
--                            written via service role only)
--   client_last_notified_at — when the client was last emailed about new
--                            firm messages (job worker, service role only)
create table if not exists client_message_threads (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  firm_last_read_at timestamptz,
  client_last_read_at timestamptz,
  client_last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  -- ONE thread per engagement; get-or-create on first send.
  unique (engagement_id)
);
create index if not exists client_message_threads_firm_idx
  on client_message_threads (firm_id);

-- Append-only transcript. No UPDATE/DELETE policies exist, so messages are
-- permanent and uneditable — a real correspondence record for an accounting
-- firm. sender_name is denormalized at send time so the thread stays
-- readable after a teammate is removed (SET NULL on sender_user_id).
create table if not exists client_messages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  sender text not null check (sender in ('firm', 'client')),
  -- Which firm member wrote a 'firm' message; always null for 'client'.
  sender_user_id uuid references users(id) on delete set null,
  sender_name text not null check (char_length(sender_name) <= 200),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists client_messages_engagement_idx
  on client_messages (engagement_id, created_at);

-- RLS + grants, following the repo's table-grant hardening pattern (0190 /
-- 0390 / 0550): revoke the default PostgREST grants, re-grant only what the
-- app needs to `authenticated` (anon gets NOTHING), then firm-scope every
-- path with policies.

alter table client_message_threads enable row level security;

drop policy if exists client_message_threads_select on client_message_threads;
create policy client_message_threads_select on client_message_threads
  for select using (firm_id = public.current_firm_id());

-- Same containment rule as 0550: the engagement must belong to the caller's
-- firm too, otherwise a member of firm A could insert a row pointing at firm
-- B's engagement and the unique(engagement_id) constraint would permanently
-- block firm B's thread — a cross-tenant denial of service.
drop policy if exists client_message_threads_insert on client_message_threads;
create policy client_message_threads_insert on client_message_threads
  for insert with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from engagements e
      where e.id = engagement_id
        and e.firm_id = public.current_firm_id()
    )
  );

-- Firm members may only stamp their OWN read pointer. The column whitelist
-- (grant below, 0039 pattern) blocks writes to client_last_read_at /
-- client_last_notified_at — those belong to the service role.
drop policy if exists client_message_threads_update on client_message_threads;
create policy client_message_threads_update on client_message_threads
  for update using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

revoke all on client_message_threads from anon, authenticated;
grant select, insert on client_message_threads to authenticated;
grant update (firm_last_read_at) on client_message_threads to authenticated;

alter table client_messages enable row level security;

drop policy if exists client_messages_select on client_messages;
create policy client_messages_select on client_messages
  for select using (firm_id = public.current_firm_id());

-- INSERT only, and only as yourself: a firm member cannot forge a client
-- message (sender must be 'firm') nor a teammate's (sender_user_id must be
-- their own auth.uid()). Client rows are written by the service role only.
-- Same engagement-containment check as the thread insert.
drop policy if exists client_messages_insert on client_messages;
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
  );

revoke all on client_messages from anon, authenticated;
grant select, insert on client_messages to authenticated;
