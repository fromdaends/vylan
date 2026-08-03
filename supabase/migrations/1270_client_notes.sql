-- Client notes — a running, ATTRIBUTED log of what the firm knows about a
-- client. "Spoke to Marie, she is switching bookkeepers in March." "Do not
-- email the info@ address, nobody reads it."
--
-- WHY A TABLE AND NOT THE COLUMN WE ALREADY HAVE. clients.notes is a single
-- text blob: one shared box that everybody overwrites, with no author, no date
-- and no history. Two people editing it in the same afternoon silently lose
-- each other's work, and nobody can tell whether a line was written last week
-- or three years ago by someone who has since left. The founder asked for notes
-- "where you can view added by the person", and that is not a formatting change
-- to a blob — it is rows.
--
-- The old column is deliberately LEFT ALONE. It still renders on the overview
-- as the client's standing description, and dropping or migrating it would be
-- a data change dressed up as a feature. New notes go here; the blob keeps
-- whatever it already holds.
--
-- SHAPE COPIED FROM file_comments (0800), on purpose: same firm-scoped RLS,
-- same denormalized author_name so a note stays readable after its author
-- leaves the firm, same author-only delete, and NO update path — a note is a
-- record of what somebody said at a moment, and silently editable history is
-- worse than none. Corrections are a new note.
--
-- Migration number: 1260 was the highest on main and no number is duplicated
-- (checked per the house rule); 1270 is the next free one.

create table if not exists client_notes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- Author. SET NULL rather than cascade: losing the person must not delete
  -- the firm's record of what they wrote.
  author_user_id uuid references auth.users(id) on delete set null,
  -- Captured at write time so a departed author still has a name on the note.
  -- The reader resolves the CURRENT name when the user row is still visible,
  -- so a rename updates every past note; this is the fallback.
  author_name text not null check (char_length(author_name) <= 200),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

-- The only read: one client's notes, newest first.
create index if not exists client_notes_client_idx
  on client_notes (client_id, created_at desc);
create index if not exists client_notes_firm_idx on client_notes (firm_id);

alter table client_notes enable row level security;

-- Same shape as month_end_closes / bank_statement_balances: firm isolation
-- plus the private-client cascade — a private client's notes are exactly as
-- restricted as the knowledge that the client exists.
drop policy if exists client_notes_select on client_notes;
create policy client_notes_select on client_notes for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

-- Write as YOURSELF, on your own firm's client. author_user_id = auth.uid()
-- is what makes the attribution trustworthy: without it the column is a
-- free-text claim about who wrote something.
drop policy if exists client_notes_insert on client_notes;
create policy client_notes_insert on client_notes for insert
  with check (
    firm_id = public.current_firm_id()
    and author_user_id = auth.uid()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

-- An author may delete their OWN note (a correction). No UPDATE policy at all,
-- so history cannot be quietly rewritten.
drop policy if exists client_notes_delete on client_notes;
create policy client_notes_delete on client_notes for delete
  using (
    firm_id = public.current_firm_id()
    and author_user_id = auth.uid()
  );

revoke all on client_notes from anon, authenticated;
grant select, insert, delete on client_notes to authenticated;

comment on table client_notes is
  'Attributed notes on a client, newest first. Insert as yourself, delete your own, never update — a correction is a new note. clients.notes (the old single blob) is untouched.';

-- Verify after applying:
--   select client_id, author_name, left(body, 40), created_at
--     from client_notes order by created_at desc limit 5;
--
-- Expect zero rows until the first note is written.
