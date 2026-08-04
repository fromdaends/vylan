-- Six more kinds of task.
--
-- The founder: "I wanna expand the kind of task that we have because ours are,
-- like, really simple right now, and Canopy has a lot."
--
-- ── WHY THESE SIX, AND WHY NONE OF THEM GETS A SCREEN ──────────────────────
--
-- Vylan's four kinds split into two very different things, and the split is the
-- whole reason this is safe:
--
--   document_collection / signatures / deliverables
--       STRUCTURAL. Each POINTS AT a collection keyed by engagement_id, opens
--       its own screen, and is limited to one per job because a second would
--       drive the same rows as the first.
--
--   task (now shown as "Other"), and the six below
--       LABELS. They organise and filter. No screen, no collection, no limit.
--
-- The six are named from the work an accounting firm actually files under, and
-- from Canopy's own Task type column where it overlaps: a Notice is the CRA
-- letter you have to answer, Bookkeeping is the monthly close, Tax return is
-- the preparation itself. They are ordinary tasks wearing a name.
--
-- ⚠️ NOT FIRM-DEFINED, unlike the statuses landing beside them. A kind decides
-- which SCREEN opens, and a firm cannot invent a screen — so a firm-defined
-- kind would be a promise the product cannot keep. Statuses are the opposite:
-- they carry no behaviour beyond a bucket, which is exactly why those DO become
-- the firm's to name.
--
-- ── WHY A CHECK CONSTRAINT AND NOT AN ENUM ─────────────────────────────────
--
-- 1370 chose text + check for this column, and this is the payoff: widening the
-- allowed set is one constraint swap with no type surgery, no ALTER TYPE, and
-- no risk of the 42804 that made 1370 abort on its first run.
--
-- Idempotent. Existing rows are untouched — every one of them is already a
-- value that survives into the wider set.

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'engagement_tasks_kind_check'
  ) then
    alter table public.engagement_tasks
      drop constraint engagement_tasks_kind_check;
  end if;

  alter table public.engagement_tasks
    add constraint engagement_tasks_kind_check
    check (kind in (
      -- Structural: these three own a collection and open a screen.
      'document_collection',
      'signatures',
      'deliverables',
      -- Labels: ordinary tasks with a name, an icon and nothing else.
      'tax_return',
      'bookkeeping',
      'notice',
      'review',
      'meeting',
      'filing',
      'task'
    ));
end $$;

comment on column public.engagement_tasks.kind is
  'What sort of work this is. THREE of these are structural — document_collection, signatures and deliverables each POINT AT a collection keyed by engagement_id, open their own screen, and are one-per-job. Every other value is a LABEL on an ordinary task: no screen, no collection, no limit. Adding a label is a constraint swap; adding a structural kind means building its screen first.';

-- Verify after applying:
--
--   -- Nothing was reclassified; the set merely got wider:
--   select kind, count(*) from engagement_tasks group by kind order by 2 desc;
--   --> the same four values as before, with the same counts.
--
--   -- And the new ones are accepted (roll it back, this is only a probe):
--   begin;
--     update engagement_tasks set kind = 'notice'
--      where id = (select id from engagement_tasks where kind = 'task' limit 1);
--   rollback;
