-- QuickBooks Feature 3 — learn from the accountant's corrections.
--
-- Remembers, PER FIRM, the mapping the accountant confirmed for a signal read off
-- a document, so the matcher (src/lib/quickbooks/suggest.ts) can auto-pick the
-- same QuickBooks entity next time instead of fuzzy-guessing:
--   * a vendor / customer name    -> a specific QuickBooks vendor / customer
--   * a vendor name               -> the expense account they code it to
--   * a split line's description  -> its expense account
--   * a document's tax set        -> the tax code they use
--
-- Like the Stage-2 cache (0420) + suggestions (0430) this is NON-SECRET firm data:
-- firm members may SELECT their OWN firm's rows via RLS; all WRITES are
-- service-role-only (the resolve route records a mapping when the accountant picks
-- a field). The app degrades gracefully (isMissingSchema) until this lands: reads
-- return {} and writes no-op, so matching just behaves as before (fuzzy only).
--
-- Additive + reversible (down: drop the table).

create table if not exists quickbooks_learned_mappings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  -- Which kind of signal this remembers. One of:
  -- 'vendor' | 'customer' | 'expense_account' | 'line_account' | 'tax'.
  signal_type text not null,
  -- The NORMALIZED lookup key: the meaningful name tokens joined ("home depot"),
  -- or the canonical tax-token set ("GST+QST"). The matcher recomputes the same
  -- key from a new document and looks it up here.
  source_key text not null,
  -- The raw text last seen for this key (display / debugging only).
  source_sample text,
  -- The QuickBooks entity the accountant chose (id + name at choice time).
  target_qbo_id text not null,
  target_qbo_name text not null,
  -- Reserved: how many times this mapping has been re-confirmed (not yet used).
  times_confirmed integer not null default 1,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One remembered target per (firm, signal, key); the resolve route upserts it.
  unique (firm_id, signal_type, source_key)
);
create index if not exists qbo_learned_firm_idx
  on quickbooks_learned_mappings (firm_id);

-- RLS: firm members READ their own firm's mappings (non-secret). No write policy
-- => authenticated writes are denied; the resolve route writes via the service
-- role (bypasses RLS). Revoke the default PostgREST grants + re-grant SELECT to
-- authenticated only — the repo's table-grant hardening pattern (0190/0230/0420/0430).
alter table quickbooks_learned_mappings enable row level security;
drop policy if exists qbo_learned_select on quickbooks_learned_mappings;
create policy qbo_learned_select on quickbooks_learned_mappings for select
  using (firm_id = public.current_firm_id());
revoke all on quickbooks_learned_mappings from anon, authenticated;
grant select on quickbooks_learned_mappings to authenticated;
