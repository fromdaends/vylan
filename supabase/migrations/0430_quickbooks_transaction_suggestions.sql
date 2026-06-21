-- QuickBooks transaction suggestions — Stage 3, Phase 3.
--
-- Holds the DRAFT QuickBooks entry the mapper (src/lib/quickbooks/suggest.ts)
-- proposes for a collected receipt / sales invoice: which cached vendor/customer,
-- account, and tax code it maps to, plus the amount/date. ONE row per uploaded
-- file. This is STILL read-only on QuickBooks — nothing here posts a transaction.
-- It exists so the accountant can SEE the draft now (Phase 3) and so the future
-- approval queue (Stage 4) has a row to review/edit/approve.
--
-- Like the Stage-2 cache (0420) this is NON-SECRET firm data, so firm members may
-- SELECT their OWN firm's rows via RLS; all WRITES are service-role-only (the
-- classify worker generates the draft). The full suggestion is stored as jsonb;
-- direction + amount are denormalized for cheap listing/sorting in later stages.
--
-- Additive + reversible (down: drop the table).

create table if not exists quickbooks_transaction_suggestions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  uploaded_file_id uuid not null references uploaded_files(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  -- The full TransactionSuggestion produced by the mapper.
  suggestion jsonb not null,
  -- Denormalized for filtering/sorting without unpacking the jsonb. Stage 4 will
  -- widen `status` (review/approve/reject); for now every row is a 'draft'.
  direction text,
  amount numeric,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One draft per file; the worker upserts on (re)classification.
  unique (uploaded_file_id)
);
create index if not exists qbo_tx_suggestions_engagement_idx
  on quickbooks_transaction_suggestions (engagement_id);
create index if not exists qbo_tx_suggestions_firm_idx
  on quickbooks_transaction_suggestions (firm_id);

-- RLS: firm members may READ their own firm's suggestions (non-secret). No write
-- policy => authenticated insert/update/delete are denied; the classify worker
-- writes via the service role (which bypasses RLS). Revoke the default PostgREST
-- grants and re-grant SELECT to authenticated ONLY (removing anon entirely) — the
-- repo's table-grant hardening pattern (0190 / 0230 / 0420). The firm-scoped
-- SELECT policy then gates which rows authenticated can read.
alter table quickbooks_transaction_suggestions enable row level security;
drop policy if exists qbo_tx_suggestions_select on quickbooks_transaction_suggestions;
create policy qbo_tx_suggestions_select on quickbooks_transaction_suggestions for select
  using (firm_id = public.current_firm_id());
revoke all on quickbooks_transaction_suggestions from anon, authenticated;
grant select on quickbooks_transaction_suggestions to authenticated;
