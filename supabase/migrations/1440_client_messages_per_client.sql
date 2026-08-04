-- Client messaging becomes PER-CLIENT and permanent (founder ruling,
-- 2026-08-05): "instead of messages with your client being about an
-- engagement, for the accountant it's a complete general chat that lasts
-- forever. But for the client, they could only text through the portal."
--
-- 0650 keyed the thread on the ENGAGEMENT (unique (engagement_id)), so a
-- client with three engagements had three separate conversations and each one
-- went read-only when its engagement completed. This re-keys the thread on the
-- CLIENT: one forever thread per client, every old per-engagement thread
-- folded into it.
--
-- engagement_id is KEPT on both tables (nullable) rather than dropped:
--   * on client_messages it is real provenance — which portal the client was
--     standing in when they wrote, or which engagement the accountant was
--     looking at. Nothing reads it for scoping any more; it is history.
--   * on client_message_threads it is now meaningless (the surviving row of a
--     merge arbitrarily kept one of N), but dropping a column is gated by
--     CLAUDE.md and keeping it costs nothing and preserves a rollback path.
--
-- Additive + idempotent. Reversible in principle (every message still carries
-- its engagement_id, so the old per-engagement grouping can be rebuilt), but
-- the merged read/notify pointers are lossy — see the merge block below.
--
-- GATED, and the existing gate already covers it: the code's
-- isClientMessagingSchemaMissing() matches the missing-COLUMN codes (PGRST204 /
-- 42703) as well as missing-table, so every reader/writer degrades to the quiet
-- "messaging not activated yet" state while this file is unapplied. Deploying
-- the code first is safe.

-- ---------------------------------------------------------------------------
-- 1. The client key
-- ---------------------------------------------------------------------------

alter table client_message_threads
  add column if not exists client_id uuid references clients(id) on delete cascade;
alter table client_messages
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- Backfill from the engagement each row was created under. engagements.client_id
-- is NOT NULL and both engagement_id FKs cascade on delete, so every existing
-- row resolves — there is no orphan case to handle.
update client_message_threads t
set client_id = e.client_id
from engagements e
where e.id = t.engagement_id and t.client_id is null;

update client_messages m
set client_id = e.client_id
from engagements e
where e.id = m.engagement_id and m.client_id is null;

-- The engagement is now optional on both tables: the accountant can write to a
-- client who has no engagement at all, and a merged thread has no single one.
alter table client_message_threads alter column engagement_id drop not null;
alter table client_messages alter column engagement_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. Merge the per-engagement threads into one row per client
-- ---------------------------------------------------------------------------
--
-- The read/notify pointers cannot merge losslessly, so each one is folded in
-- the direction whose failure is harmless:
--
--   firm_last_read_at / client_last_read_at -> NULL wins, else the OLDEST.
--     Failing this way can only RE-SHOW a message someone already read; the
--     other direction would silently hide one that was never read. (In practice
--     a null stamp means an unopened thread, which genuinely is unread: threads
--     are created on first send and a firm send stamps the firm pointer.)
--
--   client_last_notified_at -> the NEWEST.
--     This one is a spam guard, so failing the other way would re-email the
--     client about messages they were already told about. Any message sent
--     after this migration is newer than the watermark, so real notifications
--     are unaffected.
--
-- The survivor is the client's earliest thread, and it inherits the earliest
-- created_at so "when this conversation started" stays true.

with agg as (
  select
    client_id,
    (array_agg(id order by created_at, id))[1] as keep_id,
    min(created_at) as first_created_at,
    case when bool_or(firm_last_read_at is null)
      then null else min(firm_last_read_at) end as merged_firm_read,
    case when bool_or(client_last_read_at is null)
      then null else min(client_last_read_at) end as merged_client_read,
    max(client_last_notified_at) as merged_client_notified
  from client_message_threads
  where client_id is not null
  group by client_id
)
update client_message_threads t
set
  firm_last_read_at = agg.merged_firm_read,
  client_last_read_at = agg.merged_client_read,
  client_last_notified_at = agg.merged_client_notified,
  created_at = agg.first_created_at
from agg
where t.id = agg.keep_id;

delete from client_message_threads t
using (
  select client_id, (array_agg(id order by created_at, id))[1] as keep_id
  from client_message_threads
  where client_id is not null
  group by client_id
) keep
where t.client_id = keep.client_id and t.id <> keep.keep_id;

-- ---------------------------------------------------------------------------
-- 3. Re-key: one thread per CLIENT, not per engagement
-- ---------------------------------------------------------------------------

-- 0650's unique(engagement_id) is what forced a thread per engagement. It has
-- to go before the client key can hold.
alter table client_message_threads
  drop constraint if exists client_message_threads_engagement_id_key;

-- A unique INDEX rather than a constraint: idempotent via `if not exists`, and
-- get-or-create's 23505 race handling works identically against either.
create unique index if not exists client_message_threads_client_key
  on client_message_threads (client_id);

create index if not exists client_message_threads_client_idx
  on client_message_threads (client_id);
create index if not exists client_messages_client_idx
  on client_messages (client_id, created_at);

-- NOT NULL only once the backfill above has actually left no nulls behind —
-- guarded so a partial/aborted apply can be re-run instead of erroring out.
do $$
begin
  if not exists (select 1 from client_message_threads where client_id is null) then
    alter table client_message_threads alter column client_id set not null;
  end if;
  if not exists (select 1 from client_messages where client_id is null) then
    alter table client_messages alter column client_id set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS — containment moves from the engagement to the client
-- ---------------------------------------------------------------------------
--
-- Same shape and the same reasoning as 0650, one table over: a member of firm A
-- must not be able to insert a row pointing at firm B's client, because the
-- unique(client_id) index would then permanently block firm B's own thread —
-- a cross-tenant denial of service. SELECT/UPDATE stay firm-scoped exactly as
-- before, and the column grants (firm_last_read_at only) are unchanged, so the
-- client-side pointers remain service-role territory.

drop policy if exists client_message_threads_insert on client_message_threads;
create policy client_message_threads_insert on client_message_threads
  for insert with check (
    firm_id = public.current_firm_id()
    and exists (
      select 1 from clients c
      where c.id = client_id
        and c.firm_id = public.current_firm_id()
    )
  );

drop policy if exists client_messages_insert on client_messages;
create policy client_messages_insert on client_messages
  for insert with check (
    firm_id = public.current_firm_id()
    and sender = 'firm'
    and sender_user_id = auth.uid()
    and exists (
      select 1 from clients c
      where c.id = client_id
        and c.firm_id = public.current_firm_id()
    )
  );
