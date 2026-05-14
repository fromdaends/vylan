-- AI usability assessment + auto-rejection.
--
-- Phase 1 of "auto-reject unusable documents". Pure plumbing — the new
-- columns are read by Phase 2 (classifier) and acted on by Phase 3
-- (routing). No existing column or row is mutated; everything is
-- additive with safe defaults.
--
-- Schema additions:
--   firms.auto_reject_unusable_docs   bool, default false (opt-in)
--   uploaded_files.ai_usability       jsonb, the model's verdict
--   uploaded_files.ai_rejected        bool,  did the system reject?
--   request_items.ai_rejection_count  int,   strike counter for
--                                            escalation after 2 misses
--   ai_rejection_overrides            new table — when an accountant
--                                     says "the AI was wrong", we log
--                                     it here for future tuning.
--
-- The override table is engagement-scoped through file_id → engagement,
-- matching the existing uploaded_files RLS policy so the same firm
-- isolation applies without copy-pasting subqueries.

-- Firm-level opt-in.
alter table firms
  add column if not exists auto_reject_unusable_docs boolean not null default false;

-- Per-upload usability verdict from the classifier.
alter table uploaded_files
  add column if not exists ai_usability jsonb;
alter table uploaded_files
  add column if not exists ai_rejected boolean not null default false;

-- Per-item rejection counter. Increments each time the AI auto-rejects
-- an upload for this request item; resets only when an accountant
-- overrides the rejection (Phase 3 / 5).
alter table request_items
  add column if not exists ai_rejection_count integer not null default 0;

-- Override log. Each row says: "the AI rejected this file, a human
-- said the AI was wrong, here's the reason." Used in Phase 5 for the
-- accountant override flow and later for prompt-tuning.
create table if not exists ai_rejection_overrides (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references uploaded_files(id) on delete cascade,
  overridden_by_user_id uuid not null references users(id) on delete set null,
  original_issue text,
  override_reason text,
  created_at timestamptz not null default now()
);

create index if not exists ai_rejection_overrides_file_id_idx
  on ai_rejection_overrides(file_id);
create index if not exists ai_rejection_overrides_user_id_idx
  on ai_rejection_overrides(overridden_by_user_id);

alter table ai_rejection_overrides enable row level security;

-- Members of the firm that owns the engagement (via the file) can
-- read and insert override rows. Mirrors the uploaded_files_all
-- policy's join shape.
drop policy if exists ai_rejection_overrides_all on ai_rejection_overrides;
create policy ai_rejection_overrides_all on ai_rejection_overrides for all
  using (
    exists (
      select 1
      from uploaded_files f
      join engagements e on e.id = f.engagement_id
      where f.id = ai_rejection_overrides.file_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1
      from uploaded_files f
      join engagements e on e.id = f.engagement_id
      where f.id = ai_rejection_overrides.file_id
        and e.firm_id = public.current_firm_id()
    )
  );
