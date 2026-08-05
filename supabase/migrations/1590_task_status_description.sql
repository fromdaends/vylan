-- A status can explain itself, and the three every firm starts with say so.
--
-- Founder's instruction, grounded in Canopy's own help centre
-- (support.getcanopy.com/en/articles/13000023, which covers task statuses):
-- a status carries a DESCRIPTION, and the ones the product ships are labelled
-- as presets rather than passed off as something the firm wrote.
--
-- ── WHY A DESCRIPTION IS WORTH A COLUMN ────────────────────────────────────
--
-- The whole point of firm-named statuses is that the name is what people SAY.
-- But a name is three words, and the interesting ones are ambiguous exactly
-- when they matter: does "With client" mean we are blocked, or that we have
-- delivered? 1420 already warns that a firm filing "With client" under finished
-- gets progress bars it does not believe. The description is where that gets
-- settled once, in the place the person naming it is already standing.
--
-- ── WHY is_builtin IS A COLUMN AND NOT `created_by IS NULL` ────────────────
--
-- The seed in 1420 leaves created_by null while every status made through the
-- editor carries its author, so "created_by is null" LOOKS like a free
-- built-in test. It is not a safe one: created_by is `on delete set null`, so
-- the day the teammate who added "With client" is removed from the firm, their
-- status silently becomes a preset. A flag that means what it says cannot drift
-- that way.
--
-- Backfilled from that same test, which IS accurate right now — no firm can
-- have lost an author yet without also having had a custom status, and the
-- seeded three are the only rows with a null author on a fresh install. Doing
-- it at this moment is what makes it true; deriving it forever would not.
--
-- Both columns are additive and nullable/defaulted, so a deployment ahead of
-- its database keeps working: the reader coalesces description to null and
-- is_builtin to false, which renders exactly today's UI.
--
-- Migration number: 1580 is the highest on main and the duplicate check
--   ls supabase/migrations | sed 's/_.*//' | sort | uniq -d
-- prints nothing, so 1590 is next. RE-RUN THAT CHECK IMMEDIATELY BEFORE
-- MERGING — three collisions in one session earlier today all landed in the
-- window between opening a PR and it merging, and src/lib/db/migrations.test.ts
-- now fails the suite if one slips through.

alter table public.task_statuses
  add column if not exists description text
    check (description is null or char_length(description) <= 160);

alter table public.task_statuses
  add column if not exists is_builtin boolean not null default false;

-- The three from 1420's seed. Guarded so a re-run cannot promote a status the
-- firm has since created (it would have an author).
update public.task_statuses
   set is_builtin = true
 where created_by is null
   and is_builtin = false;

comment on column public.task_statuses.description is
  'One line saying what this status MEANS — settled where it is named, because a three-word label is ambiguous exactly when it matters ("With client": blocked, or delivered?). Null = no explanation offered.';
comment on column public.task_statuses.is_builtin is
  'True for the three statuses every firm is seeded with (1420). Shown as "Preset" so the product does not pass its own defaults off as the firm''s work. Deliberately NOT derived from created_by, which is set-null on user deletion and would silently reclassify a custom status.';

-- Verify after applying — expect 3 presets per firm and no descriptions yet:
--   select is_builtin, count(*), count(description) as with_description
--     from task_statuses group by is_builtin order by is_builtin;
