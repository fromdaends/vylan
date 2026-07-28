-- Near-duplicate documents: flag, never set aside.
--
-- 0270 gave us is_duplicate + duplicate_of_file_id, which mean something quite
-- strong: this file is a BYTE-IDENTICAL re-upload, so it is set aside entirely
-- (deriveItemStatus skips duplicates, the client is never nagged for it, and
-- with the firm's auto-reject setting on it is rejected outright). That is only
-- safe because a matching SHA-256 has no false positives.
--
-- The new check is different in kind. It compares what the AI read off the
-- document -- supplier, total, document number, date -- so it catches the same
-- invoice photographed AND emailed, which is the commonest real duplicate and
-- which the hash check sails straight past. But it is PROBABILISTIC: a client
-- on a monthly retainer genuinely bills the same supplier the same amount every
-- month. Reusing is_duplicate for it would silently set aside a real document.
--
-- Hence a separate, softer column. It flags for review and changes nothing
-- else: the file stays live, the checklist still counts it, nothing is
-- rejected. The accountant decides.
--
-- Nullable with no default, so every existing row reads as "not flagged" and no
-- backfill is needed. Additive + reversible (down: drop the column).

alter table uploaded_files
  add column if not exists possible_duplicate_of_file_id uuid
    references uploaded_files(id) on delete set null;

-- Finding a file's flagged siblings, and the reverse lookup from the original.
create index if not exists uploaded_files_possible_dup_idx
  on uploaded_files (possible_duplicate_of_file_id)
  where possible_duplicate_of_file_id is not null;

-- Verify after applying:
--   select column_name from information_schema.columns
--    where table_name = 'uploaded_files'
--      and column_name = 'possible_duplicate_of_file_id';
