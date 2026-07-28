-- 0920_notifications.sql
--
-- Notifications — the firm-facing notification system (accountants + staff).
-- Client-facing chase cadence is NOT here; that stays in the Automation tab.
--
-- Context from the Phase 0 audit (docs/notifications-phase0-audit.md): an in-app
-- feed already exists, but it is DERIVED — src/lib/home/notifications.ts
-- recomputes ~14 "kinds" from activity_log + live engagement state on every page
-- load. That design cannot carry read-state, per-user preferences, muting, or
-- deletion, because there is no row to write to. These tables give each
-- notification a real row; listHomeNotifications keeps its signature and swaps
-- its body to read from here (its own TODO(notifications-table) describes exactly
-- this seam), so the bell, /notifications and while-you-were-away keep working.
--
-- Deliberately NOT created here: a notification_email_queue table. The `jobs`
-- table (0001) already is a deferred queue with run_after, attempts, backoff,
-- status and cancelPendingJobs, and is already drained every 2 minutes by
-- /api/cron/process-jobs. Digest + quiet-hours deferral ride that queue as a
-- `send_notification_email` job kind instead of a second scheduler.
--
-- Numbering: highest on main was 0910, so 0920 per the +10 multi-session buffer.
-- MIGRATION SAFETY: purely additive — new tables only, no existing table is
-- altered and no existing behavior changes until application code reads these.

-------------------------------------------------------------------------------
-- notifications — the feed itself
-------------------------------------------------------------------------------

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- Recipient. One row PER RECIPIENT (a firm event fans out to N rows) so read
  -- state, dismissal and muting are all naturally per-person.
  user_id uuid not null references users(id) on delete cascade,
  -- Catalog key, e.g. 'document.uploaded'. Kept as text rather than an enum so
  -- adding an event is a code change, not a migration. The catalog in
  -- src/lib/notifications/catalog.ts is the single source of truth.
  event_key text not null check (char_length(event_key) between 1 and 64),
  -- What it is about. Null for firm-level events (billing, integrations) that
  -- have no row to point at.
  entity_type text check (
    entity_type in ('engagement', 'client', 'document', 'invoice', 'signature')
  ),
  entity_id uuid,
  -- Who caused it. SET NULL so a removed teammate's notifications survive.
  -- Null when a CLIENT or the system triggered it (clients have no user row).
  actor_id uuid references users(id) on delete set null,
  -- Everything the in-app row and the email template need to render without a
  -- join: names, counts, amounts. Also carries `first_at` for bundled rows,
  -- since bundling moves created_at forward (see below).
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  -- The founder's "delete" on a notification. SOFT, deliberately: a hard delete
  -- would let the emitter's bundling resurrect a row the user just cleared (the
  -- bundle lookup would find nothing and insert a fresh one), and there is no
  -- undo anywhere in this UI. Dismissed rows are filtered out of every read.
  dismissed_at timestamptz,
  email_sent_at timestamptz,
  -- Sort key. Bundling MOVES this forward so a re-occurring event resurfaces at
  -- the top; payload.first_at preserves when it was first seen.
  created_at timestamptz not null default now()
);

-- The feed query: this user's rows, newest first, unread-filterable.
create index if not exists notifications_user_feed_idx
  on notifications (user_id, read_at, created_at desc);

-- Firm-wide reads (admin/debug + any future firm digest).
create index if not exists notifications_firm_created_idx
  on notifications (firm_id, created_at desc);

-- The bundling lookup, run on EVERY emit: "is there already a live row for this
-- (user, event, entity)?". Partial so it only indexes rows that can still be
-- bundled into — which is a small fraction of the table.
create index if not exists notifications_bundle_idx
  on notifications (user_id, event_key, entity_id, created_at desc)
  where read_at is null and dismissed_at is null;

alter table notifications enable row level security;

-- Read only your own. Note this is intentionally NOT firm-wide: a notification
-- is addressed to a person, and one teammate must never read another's feed
-- (acceptance criterion 8).
drop policy if exists notifications_select_own on notifications;
create policy notifications_select_own on notifications
  for select using (user_id = auth.uid());

-- Mark read / unread / dismissed on your own rows. Which COLUMNS may change is
-- enforced by the column-level grant below, not by this policy — the same
-- belt-and-braces approach 0039 uses for firms.
drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No INSERT policy: rows are written ONLY by the emitter via the service role.
-- A user cannot forge a notification (to themselves or anyone else).
-- No DELETE policy: "delete" is dismissed_at, above.
revoke all on notifications from anon, authenticated;
grant select on notifications to authenticated;
grant update (read_at, dismissed_at) on notifications to authenticated;

-------------------------------------------------------------------------------
-- notification_preferences — per-user, per-event switches
-------------------------------------------------------------------------------
--
-- Rows are created LAZILY. A missing row means "use the catalog default", so a
-- new user costs zero rows and changing a default in code changes it for
-- everyone who never touched that switch. Never backfill 30 rows per user.

create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Denormalized for firm-scoped cleanup and so RLS never needs a join.
  firm_id uuid not null references firms(id) on delete cascade,
  event_key text not null check (char_length(event_key) between 1 and 64),
  in_app boolean not null default true,
  email boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists notification_preferences_user_idx
  on notification_preferences (user_id);

alter table notification_preferences enable row level security;

-- Your own preferences only, in your own firm.
drop policy if exists notification_preferences_rw on notification_preferences;
create policy notification_preferences_rw on notification_preferences
  for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id());

revoke all on notification_preferences from anon, authenticated;
grant select, insert, update, delete on notification_preferences to authenticated;

-------------------------------------------------------------------------------
-- notification_settings — per-user global delivery controls (one row per user)
-------------------------------------------------------------------------------

create table if not exists notification_settings (
  user_id uuid primary key references users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  -- Master kill switch for ALL email. Events flagged can_disable:false in the
  -- catalog bypass it (failed billing, security) — enforced in the emitter.
  email_enabled boolean not null default true,
  -- 'assigned_only' narrows the feed to engagements assigned to this user.
  -- Matches what staff already get today; owners default to firm-wide.
  scope text not null default 'all_firm'
    check (scope in ('assigned_only', 'all_firm')),
  email_mode text not null default 'instant'
    check (email_mode in ('instant', 'hourly_digest', 'daily_digest')),
  daily_digest_time time not null default '08:00',
  -- Per-user, because a firm can have a teammate in another province. Seeded
  -- from firms.timezone on first write (a column DEFAULT cannot read another
  -- table, so the literal here is only a last-resort fallback).
  timezone text not null default 'America/Toronto',
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '20:00',
  quiet_hours_end time not null default '07:00',
  pause_weekends boolean not null default false,
  -- 'minimal' strips client names, document names and amounts from the email
  -- body and subject — for Law 25 comfort and shared inboxes.
  email_detail_level text not null default 'full'
    check (email_detail_level in ('full', 'minimal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notification_settings enable row level security;

drop policy if exists notification_settings_rw on notification_settings;
create policy notification_settings_rw on notification_settings
  for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id());

revoke all on notification_settings from anon, authenticated;
grant select, insert, update on notification_settings to authenticated;

-------------------------------------------------------------------------------
-- notification_mutes — "stop telling me about this one thing"
-------------------------------------------------------------------------------
--
-- Set contextually from an engagement or client page. The Notifications tab is
-- the only place they are managed centrally (list + unmute).

create table if not exists notification_mutes (
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id) on delete cascade,
  entity_type text not null check (entity_type in ('engagement', 'client')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

create index if not exists notification_mutes_user_idx
  on notification_mutes (user_id);

alter table notification_mutes enable row level security;

drop policy if exists notification_mutes_rw on notification_mutes;
create policy notification_mutes_rw on notification_mutes
  for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id());

revoke all on notification_mutes from anon, authenticated;
grant select, insert, delete on notification_mutes to authenticated;

-------------------------------------------------------------------------------
-- Column documentation
-------------------------------------------------------------------------------

comment on table notifications is
  'Firm-facing notification feed, one row per recipient. Written only by the notify() emitter via the service role; users may only flip read_at/dismissed_at on their own rows.';
comment on column notifications.dismissed_at is
  'Soft delete ("Delete" in the UI). Soft so bundling cannot resurrect a cleared row, and because there is no undo in the feed UI.';
comment on column notifications.created_at is
  'Sort key. Bundling moves it forward when the same event re-fires; payload.first_at keeps the original time.';
comment on table notification_preferences is
  'Per-user, per-event in-app/email switches. Rows are lazy: a missing row means "use the catalog default in src/lib/notifications/catalog.ts".';
comment on table notification_settings is
  'Per-user global delivery controls (master email switch, scope, digest mode, timezone, quiet hours, detail level). One row per user, created lazily on first save.';
comment on table notification_mutes is
  'Per-user per-entity mute. Muting an engagement or client suppresses every notification about it, including its children.';
