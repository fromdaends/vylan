-- Saved views — the filters you use every week, named and kept.
--
-- The founder: "There should be an option to create/edit your own based off the
-- filters below the dividers like the ones you click and can see. Its like an
-- ease of use settings and canopy has it. But make it subtle and hide it in the
-- 3 dots."
--
-- Canopy's client list shows exactly this: their tab strip reads "Active
-- Clients | New Clients 2022 | Prospect | Business | Individual | Ben's
-- Clients". Everything after the built-ins is somebody's saved filter.
--
-- ── ONE TABLE FOR EVERY LIST ──────────────────────────────────────────────
--
-- `surface` says which list it belongs to (engagements / tasks / clients) and
-- `filters` is that list's own state, stored opaquely. Three tables with three
-- CRUDs and three menus would drift the first time one was touched, and the
-- thing being saved genuinely is the same thing each time: "the list, as I had
-- it set up".
--
-- WHY filters IS jsonb AND NOT COLUMNS. Each list filters on different things —
-- tasks by status/kind/priority, engagements by stage/service — and they change
-- as the lists grow. Columns would mean a migration every time somebody adds a
-- filter, and a saved view that silently loses the filter the column forgot.
-- The blob is written and read by the SAME component, so nothing else has to
-- understand it. It is validated on read (unknown keys ignored, missing ones
-- default) rather than trusted, because a view saved by an older build must not
-- break a newer one.
--
-- ── PERSONAL, NOT FIRM-WIDE (for now) ─────────────────────────────────────
--
-- user_id is NOT NULL. The founder's words were "create/edit your OWN", and a
-- shared view raises questions this does not need to answer yet: who may edit
-- one, what happens when its author leaves, whether a teammate's view appearing
-- in your tab strip is help or clutter. A firm-wide flag can be added later
-- without moving any data; going the other way would mean deciding, for every
-- existing row, whose it was.
--
-- Migration number: 1620 is the highest and the duplicate check
--   ls supabase/migrations | sed 's/_.*//' | sort | uniq -d
-- prints nothing, so 1630 is next. RE-RUN IT IMMEDIATELY BEFORE MERGING —
-- three collisions in one session earlier all landed in the window between
-- opening a PR and it merging, and src/lib/db/migrations.test.ts now fails the
-- suite if one slips through.

create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- Whose it is. CASCADE, not set-null: a view is a personal convenience, and
  -- an ownerless one would sit in nobody's tab strip forever.
  user_id uuid not null references users(id) on delete cascade,
  -- Which list. Text + CHECK rather than an enum: adding a fourth list should
  -- not need a type migration, and the set is small enough to read here.
  surface text not null check (surface in ('engagements', 'tasks', 'clients')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- That list's own filter state. Opaque here; validated by the reader.
  filters jsonb not null default '{}'::jsonb,
  -- Where it sits in the tab strip, after the built-ins.
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- The only read: my views for one list, in my order.
create index if not exists saved_views_mine_idx
  on saved_views (user_id, surface, sort);
create index if not exists saved_views_firm_idx on saved_views (firm_id);

-- Two views with one name on one list is a tab strip that lies about which is
-- which. Case-insensitive, because "My week" and "my week" are the same tab to
-- the person reading it.
create unique index if not exists saved_views_unique_name
  on saved_views (user_id, surface, lower(btrim(name)));

alter table saved_views enable row level security;

-- YOURS ONLY, on every path. Not "the firm's" — these are personal, and a
-- teammate reading your saved filters tells them what you are working on.
drop policy if exists saved_views_select on saved_views;
create policy saved_views_select on saved_views for select
  using (user_id = auth.uid() and firm_id = public.current_firm_id());

drop policy if exists saved_views_write on saved_views;
create policy saved_views_write on saved_views for all
  using (user_id = auth.uid() and firm_id = public.current_firm_id())
  with check (user_id = auth.uid() and firm_id = public.current_firm_id());

revoke all on saved_views from anon, authenticated;
grant select, insert, update, delete on saved_views to authenticated;

comment on table saved_views is
  'A named filter set for one list, belonging to one person. surface says which list; filters is that list''s own state, opaque here and validated on read so a view saved by an older build cannot break a newer one.';

-- Verify after applying — expect 0 until somebody saves one:
--   select surface, count(*) from saved_views group by surface;
