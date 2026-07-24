-- 0870_team_messages.sql
--
-- Team group chat — a firm-wide, internal, text-only thread. ONE thread per firm
-- (the firm IS the thread, so no threads table), all firm members chat together.
-- The CLIENT never sees it (no service-role/portal path at all). Firm-internal,
-- append-only correspondence with a per-user read pointer for unread counts.
-- Same hardened, gated, additive pattern as client_messages (0650).

create table if not exists team_messages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- Author. SET NULL so a removed teammate's messages survive; sender_name is
  -- denormalized at send time (the thread stays readable), and the app resolves
  -- the CURRENT name live where it can (same approach as file comments).
  sender_user_id uuid references users(id) on delete set null,
  sender_name text not null check (char_length(sender_name) <= 200),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists team_messages_firm_created_idx
  on team_messages (firm_id, created_at);

-- Per-user read pointer (one row per member) → independent unread counts.
create table if not exists team_message_reads (
  firm_id uuid not null references firms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (firm_id, user_id)
);

alter table team_messages enable row level security;

-- Every firm member reads the one shared thread. Firm-scoped = tenant isolation.
drop policy if exists team_messages_select on team_messages;
create policy team_messages_select on team_messages
  for select using (firm_id = public.current_firm_id());

-- Insert ONLY as yourself, ONLY into your firm — the author id (sender_user_id)
-- is immutable and can't be forged. sender_name is a denormalized display cache
-- the app fills; it is NOT trusted for display (listTeamMessages resolves the
-- current name live from the author's users row), so it can't be used to spoof a
-- teammate's shown name either.
drop policy if exists team_messages_insert on team_messages;
create policy team_messages_insert on team_messages
  for insert with check (
    firm_id = public.current_firm_id()
    and sender_user_id = auth.uid()
  );

-- Author-only delete (no UPDATE policy → messages aren't editable).
drop policy if exists team_messages_delete on team_messages;
create policy team_messages_delete on team_messages
  for delete using (
    firm_id = public.current_firm_id()
    and sender_user_id = auth.uid()
  );

revoke all on team_messages from anon, authenticated;
grant select, insert, delete on team_messages to authenticated;

alter table team_message_reads enable row level security;

-- Your own read pointer only.
drop policy if exists team_message_reads_rw on team_message_reads;
create policy team_message_reads_rw on team_message_reads
  for all
  using (firm_id = public.current_firm_id() and user_id = auth.uid())
  with check (firm_id = public.current_firm_id() and user_id = auth.uid());

revoke all on team_message_reads from anon, authenticated;
grant select, insert, update on team_message_reads to authenticated;
