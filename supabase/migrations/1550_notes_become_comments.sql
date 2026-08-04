-- Notes and comments stop co-existing. Comments win.
--
-- The founder, looking at a task panel with a Notes box directly above a
-- Comments thread: "you fucked up. Notes and comments shouldnt co-exist its one
-- or the other. get rid of notes."
--
-- They are right, and the previous PR shipping BOTH and calling the merge "a
-- data decision for later" was the mistake — it left the exact duplication the
-- whole consolidation was meant to remove, on the screen it was most visible.
--
-- THIS MIGRATION MOVES THE TEXT SO REMOVING THE BOX LOSES NOTHING.
--   * engagement_tasks.notes -> a comment on that task
--   * clients.notes          -> a comment on that client
--
-- NEITHER COLUMN IS DROPPED. Repo rule: a column is not removed without asking,
-- and keeping them means this is reversible — the text still sits in its
-- original home if anything about the copy turns out wrong. They simply stop
-- being read by any screen. A later migration can drop them once the founder
-- has seen the comments in place.
--
-- AUTHORSHIP, which is the one genuinely lossy part and is worth stating.
-- file_comments.author_name is NOT NULL because a comment is a record of who
-- said something. These notes have no author:
--   * engagement_tasks.notes has no author column at all, so the task's
--     created_by is the closest honest answer — that person made the task and
--     almost certainly wrote its note.
--   * clients.notes (0001) is a single shared blob that everyone overwrote,
--     which is precisely why client_notes (1270) replaced it. There is nobody
--     to credit, so it is attributed to the FIRM with a null author_user_id.
--     Null matters: it means no one can delete it as "their own", which is
--     correct — it is not theirs.
--
-- IDEMPOTENT. The guard matches on the target plus the exact body, so re-running
-- cannot double a note, and a note edited after this runs would arrive as a
-- second comment rather than silently replacing the first (append-only is the
-- whole contract of a comment).
--
-- ⚠️ ORDERING: this depends on 1520 (file_comments.engagement_task_id and
-- .client_id). If 1520 has not been applied, both statements below fail on the
-- unknown column and NOTHING is copied — which is safe, because the columns
-- they read from are untouched. Apply 1520 first.
--
-- Migration number: RENUMBERED FROM 1540, the THIRD collision in one session.
-- 1530 was mine and 1540 was free when this was written; #1325 then merged its
-- own 1540_engagement_assignees.sql minutes before this PR, so this became the
-- second file of the pair — again. 1550.
--
-- THE PATTERN IS NOW UNMISTAKABLE and worth writing down where the next person
-- will read it: on a repo with several sessions in flight, "highest + 10 at
-- creation" is not enough, and neither is re-checking after a pull. The number
-- must be re-verified IMMEDIATELY BEFORE MERGE, because the window that matters
-- is between opening a PR and it landing. Three collisions this session (1510,
-- 1540 twice over) all happened inside that window.
--
-- Replaying at the new number is harmless: every statement here is guarded by
-- `not exists` on the exact body, so a note already copied is not copied twice.
--
-- ⚠️ STILL BROKEN AND NOT MINE TO FIX: 1510 is duplicated on main —
-- #1312's engagement_details and #1318's workflow_automations both took it.
-- Flagged before #1318 merged; it merged anyway. Supabase's ledger keys on the
-- version, so the second file of that pair can never be tracked. Whoever owns
-- #1318 needs to renumber. Re-run
--   ls supabase/migrations | sed 's/_.*//' | sort | uniq -d

-- ── Task notes ────────────────────────────────────────────────────────────
insert into file_comments (
  firm_id, engagement_id, uploaded_file_id, request_item_id,
  engagement_task_id, client_id,
  author_user_id, author_name, body, mentions, created_at
)
select
  t.firm_id,
  t.engagement_id,          -- nullable since 1350; 1520 made this column nullable
  null, null,
  t.id,
  null,
  u.id,
  coalesce(nullif(btrim(u.display_name), ''), u.name, u.email, f.name, 'Note'),
  btrim(t.notes),
  '{}'::uuid[],
  t.created_at
from engagement_tasks t
join firms f on f.id = t.firm_id
left join users u on u.id = t.created_by
where t.notes is not null
  and btrim(t.notes) <> ''
  and not exists (
    select 1 from file_comments fc
    where fc.engagement_task_id = t.id
      and fc.body = btrim(t.notes)
  );

-- ── Client notes (the old single blob, NOT client_notes which 1520 handled) ──
insert into file_comments (
  firm_id, engagement_id, uploaded_file_id, request_item_id,
  engagement_task_id, client_id,
  author_user_id, author_name, body, mentions, created_at
)
select
  c.firm_id,
  null, null, null,
  null,
  c.id,
  null,                     -- nobody owns a blob everyone could overwrite
  coalesce(nullif(btrim(f.name), ''), 'Note'),
  btrim(c.notes),
  '{}'::uuid[],
  c.created_at
from clients c
join firms f on f.id = c.firm_id
where c.notes is not null
  and btrim(c.notes) <> ''
  and not exists (
    select 1 from file_comments fc
    where fc.client_id = c.id
      and fc.body = btrim(c.notes)
  );

comment on column public.engagement_tasks.notes is
  'DEPRECATED (1540). Copied into file_comments as a task comment; no screen reads it any more. Kept so the copy is reversible.';
comment on column public.clients.notes is
  'DEPRECATED (1540). The original 0001 single-blob note. Copied into file_comments as a client comment; no screen reads it any more. Kept so the copy is reversible.';

-- Verify after applying — the two counts should MATCH:
--   select
--     (select count(*) from engagement_tasks
--       where notes is not null and btrim(notes) <> '')      as task_notes,
--     (select count(*) from file_comments
--       where engagement_task_id is not null)                as task_comments,
--     (select count(*) from clients
--       where notes is not null and btrim(notes) <> '')      as client_blobs;
--
-- task_comments may exceed task_notes if anyone has already commented on a
-- task — that is expected. It must never be LESS.
