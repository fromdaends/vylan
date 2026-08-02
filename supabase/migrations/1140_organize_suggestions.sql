-- AI ORGANIZE — the propose-and-approve queue (Files v2 §3).
--
-- One row per (document, issue). The scanner — GPT-5.6 Luna reading file
-- NAMES and existing metadata, never document content (founder ruling
-- 2026-08-02: Terra analyzes documents at intake, Luna does all organizing)
-- — writes rows; humans approve, skip, or dismiss them. The AI never moves,
-- renames, or deletes anything on its own: approvals execute through the
-- same server actions as manual moves, so the audit trail is identical and
-- attributed to the approving user.

create table if not exists organize_suggestions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- Which document, in the three-table union firm_documents reads.
  source text not null check (source in ('checklist', 'final', 'imported')),
  document_id uuid not null,
  bucket text not null
    check (bucket in ('low_confidence', 'misfile', 'duplicate', 'unprocessed')),
  -- What the scanner saw and what it proposes, as plain jsonb: the shapes are
  -- bucket-specific ({doc_type, year, category, name…}) and versioned by the
  -- application, not the schema. current_state doubles as the STALENESS
  -- fingerprint: approval re-reads the document and refuses if it no longer
  -- matches — a suggestion made against yesterday's file must not fire
  -- against today's.
  current_state jsonb not null default '{}'::jsonb,
  proposed_state jsonb not null default '{}'::jsonb,
  -- Luna's one-line explanation, shown verbatim in the review queue.
  reasoning text,
  -- Duplicates only: the copy the firm should keep.
  keep_source text,
  keep_document_id uuid,
  status text not null default 'open'
    check (status in ('open', 'approved', 'skipped', 'dismissed', 'expired')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

-- One LIVE suggestion per document+issue. Dismissed rows participate in the
-- uniqueness on purpose: "dismissed suggestions don't reappear for that
-- file+issue" is the spec's contract, and the scanner's insert simply
-- conflicts into a no-op. Approved/skipped/expired rows fall out of the
-- index, so a skipped issue CAN come back on the next scan — that is the
-- difference between Skip and Dismiss.
create unique index if not exists organize_suggestions_live_idx
  on organize_suggestions (source, document_id, bucket)
  where status in ('open', 'dismissed');

-- The Home card's counts and the review queue both read open rows per firm.
create index if not exists organize_suggestions_open_idx
  on organize_suggestions (firm_id, status, bucket);

alter table organize_suggestions enable row level security;

-- Same shape as imported_documents (1070): firm isolation plus the
-- private-client cascade. Reviewing a private client's files is exactly as
-- restricted as seeing that client at all. INSERTs come from the scanner via
-- the service role (bypasses RLS); firm users only read and review.
drop policy if exists organize_suggestions_all on organize_suggestions;
create policy organize_suggestions_all on organize_suggestions for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

revoke all on organize_suggestions from anon, authenticated;
grant select, update on organize_suggestions to authenticated;

-- Seed the nightly scan. The job re-enqueues itself for the next 03:00 UTC
-- on every completion, so this single row starts the chain; the Home card's
-- "Review" button can also enqueue an immediate run. Deliberately scheduled
-- for TOMORROW 03:00 UTC, not now(): this SQL runs on prod before the PR
-- that teaches process-jobs the organize_scan kind has merged, and a job
-- that fires before its handler exists gets absorbed as unknown_kind and
-- the nightly chain never starts.
insert into jobs (kind, payload, run_after)
values ('organize_scan', '{}'::jsonb, date_trunc('day', now()) + interval '1 day 3 hours');
