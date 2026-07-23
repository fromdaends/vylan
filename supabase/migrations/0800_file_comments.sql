-- Team Wave 3: file comments + @mentions. Firm members leave short comments on
-- an uploaded document (a receipt / file), optionally @mentioning teammates who
-- then get an in-app notification. This is the firm's locked "messaging" answer
-- — comments ON a file, NOT a chat. FIRM-INTERNAL ONLY: the CLIENT never sees
-- these (entirely separate from client_messages 0650, which is the firm↔client
-- thread). Text only.
--
-- GATED (repo's tiered pattern, 0550/0650): the code detects a missing table
-- (isMissingFileCommentsSchema) and degrades to a quiet "not activated yet"
-- state, so this ships in the PR and is applied to prod on its own schedule
-- (dev uses remote Supabase). Additive + reversible (down: drop file_comments).
--
-- Migration number: highest on main was 0790; +10 per the multi-session rule.

create table if not exists file_comments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- Denormalized so RLS/containment + notification links don't need a join.
  engagement_id uuid not null references engagements(id) on delete cascade,
  uploaded_file_id uuid not null references uploaded_files(id) on delete cascade,
  -- Author; name denormalized at write time so the thread stays readable after
  -- a teammate is removed (SET NULL on the user).
  author_user_id uuid references users(id) on delete set null,
  author_name text not null check (char_length(author_name) <= 200),
  body text not null check (char_length(body) between 1 and 4000),
  -- The @mentioned firm-member ids (denormalized for the notify + highlight).
  -- May be empty. Not FK-enforced (an array); the composer only offers real
  -- members, and a stale id simply notifies no one.
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists file_comments_file_idx
  on file_comments (uploaded_file_id, created_at);
create index if not exists file_comments_firm_idx on file_comments (firm_id);

-- RLS + grants (mirrors client_messages 0650): revoke default PostgREST grants,
-- re-grant only what the app needs to `authenticated` (anon gets NOTHING),
-- firm-scope every path.
alter table file_comments enable row level security;

drop policy if exists file_comments_select on file_comments;
create policy file_comments_select on file_comments
  for select using (firm_id = public.current_firm_id());

-- INSERT only as yourself (author_user_id must be your auth.uid()), and only
-- against your own firm's engagement (containment, same as 0650).
drop policy if exists file_comments_insert on file_comments;
create policy file_comments_insert on file_comments
  for insert with check (
    firm_id = public.current_firm_id()
    and author_user_id = auth.uid()
    and exists (
      select 1 from engagements e
      where e.id = engagement_id
        and e.firm_id = public.current_firm_id()
    )
  );

-- An author may delete their OWN comment (a correction). No UPDATE (edit) path.
drop policy if exists file_comments_delete on file_comments;
create policy file_comments_delete on file_comments
  for delete using (
    firm_id = public.current_firm_id() and author_user_id = auth.uid()
  );

revoke all on file_comments from anon, authenticated;
grant select, insert, delete on file_comments to authenticated;
