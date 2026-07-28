-- Payment-processor payout JOURNAL drafts.
--
-- A payout statement (Stripe / Square / PayPal) becomes a multi-line journal
-- entry, not a Bill or an Invoice:
--
--     DEBIT   bank / clearing        net deposited
--     DEBIT   processing fees        fees
--     DEBIT   tax on fees            fee tax
--     DEBIT   refunds                refunds
--     DEBIT   chargebacks            adjustments
--       CREDIT  sales revenue                        gross
--
-- Which balances BY CONSTRUCTION exactly when the payout reconciles
-- (gross − refunds − fees − feeTax − adjustments = net). The builder refuses
-- to produce a journal for a payout that does NOT reconcile, so an
-- unbalanced entry can never reach a ledger.
--
-- Its own table rather than reusing quickbooks_transaction_suggestions: that
-- one is one-transaction-shaped (direction/amount columns, a vendor or
-- customer, and resolve/post machinery built around Bill/Invoice/Purchase).
-- Forcing a 6-line journal through it would corrupt both.
--
-- GATED like every post-launch table: readers treat a missing table as "the
-- payout journal isn't set up yet" (error-code checks only, the 0650 rule).
--
-- Additive + reversible. Down: drop table payout_journal_drafts;

create table if not exists payout_journal_drafts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- One journal per processor-statement upload; the worker/action upserts.
  uploaded_file_id uuid not null references uploaded_files(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  -- Which ledger this is destined for, fixed when the draft is created.
  provider text not null check (provider in ('quickbooks', 'xero')),

  -- The transcribed payout figures the journal is built from (a snapshot, so
  -- a later re-classification can't silently change an approved entry).
  figures jsonb not null,
  -- The accountant's account picks, keyed by role
  -- ("bank" | "sales" | "fees" | "fee_tax" | "refunds" | "adjustments"),
  -- each { id, name }. Roles left unmapped fold into their fallback at build
  -- time, so only bank/sales/fees are required to post.
  mapping jsonb not null default '{}'::jsonb,

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'posted', 'void')),

  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  -- The ledger's own id for the posted entry + a link back when the API
  -- returns one. Set only once status reaches 'posted'.
  posted_ref text,
  posted_link text,
  posted_by uuid references users(id) on delete set null,
  posted_at timestamptz,
  post_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (uploaded_file_id)
);

create index if not exists payout_journal_drafts_engagement_idx
  on payout_journal_drafts (engagement_id);
create index if not exists payout_journal_drafts_firm_idx
  on payout_journal_drafts (firm_id, status);

alter table payout_journal_drafts enable row level security;

-- Firm members READ their own firm's drafts; every write is service-role
-- (the server actions), matching quickbooks_transaction_suggestions (0430).
drop policy if exists payout_journal_drafts_select on payout_journal_drafts;
create policy payout_journal_drafts_select on payout_journal_drafts for select
  using (firm_id = public.current_firm_id());

-- Table-grant hardening (0190 / 0230 / 0420 / 0430): anon gets nothing, and
-- authenticated gets SELECT only — the firm-scoped policy above then decides
-- which rows.
revoke all on payout_journal_drafts from anon, authenticated;
grant select on payout_journal_drafts to authenticated;
