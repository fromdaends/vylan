-- Let a firm opt in to unattended approval of bookkeeping drafts.
--
-- Every draft currently waits for a human to click Approve, even when the
-- vendor, expense account and tax code were all filled in from what that same
-- human taught the system, on the same supplier, several times over. That click
-- carries no information. Hubdoc's autosync and Dext's supplier rules both
-- remove it — but both make you configure a rule per supplier first. We can do
-- it without any configuration, because we only ever auto-approve a coding we
-- have already watched a human perform repeatedly.
--
-- OFF BY DEFAULT, and deliberately. Nobody gets unattended approval they did
-- not ask for, and a firm that never finds this setting behaves exactly as it
-- does today.
--
-- The safety rules live in src/lib/quickbooks/auto-approve.ts, are pure, and
-- are all vetoes: expenses only, complete by the same test the Approve button
-- uses, every required field from MEMORY rather than a fuzzy guess, the mapping
-- confirmed at least 3 times, and never a suspected duplicate.
--
-- Note this approves; it does NOT post. Writing to the client's books stays a
-- separate, explicit step.
--
-- Additive + reversible (down: drop the column).

alter table firms
  add column if not exists auto_approve_bookkeeping_drafts boolean not null
    default false;

-- Firm members read it (it drives the settings toggle) and owners set it, the
-- same grant shape as auto_reject_duplicates (0270).
grant select (auto_approve_bookkeeping_drafts) on public.firms to authenticated;
grant update (auto_approve_bookkeeping_drafts) on public.firms to authenticated;

-- Verify after applying:
--   select column_name from information_schema.columns
--    where table_name = 'firms' and column_name = 'auto_approve_bookkeeping_drafts';
