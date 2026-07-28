-- Right-click commenting: file_comments learns two new TARGETS beyond an
-- uploaded file. A comment can now sit on:
--   * an uploaded FILE      (uploaded_file_id set — the original 0800 shape)
--   * a CHECKLIST ITEM      (request_item_id set)
--   * the ENGAGEMENT itself (both target columns null; engagement_id is
--     already on every row)
-- One table keeps the RLS, mention fan-out, and author plumbing shared; the
-- name "file_comments" stays (repo rule: never rename).
--
-- GATED (repo's tiered pattern): the code detects the missing column
-- (isMissingFileCommentsSchema, 42703/PGRST204) and degrades to the quiet
-- "not activated" state. HAND-MERGE migration: apply this to prod BEFORE
-- merging the PR, since the new SELECT list includes request_item_id.
--
-- Migration number: highest on main is 0910; 0920 is claimed by the
-- in-flight notifications branch (device 2), so +10 again → 0930.

alter table file_comments alter column uploaded_file_id drop not null;

alter table file_comments
  add column if not exists request_item_id uuid
    references request_items(id) on delete cascade;

-- A comment points at ONE thing: a file, an item, or (neither) the engagement.
alter table file_comments drop constraint if exists file_comments_one_target;
alter table file_comments add constraint file_comments_one_target
  check (uploaded_file_id is null or request_item_id is null);

create index if not exists file_comments_item_idx
  on file_comments (request_item_id, created_at);
-- The engagement page now loads every comment on the engagement in one query.
create index if not exists file_comments_engagement_idx
  on file_comments (engagement_id, created_at);
