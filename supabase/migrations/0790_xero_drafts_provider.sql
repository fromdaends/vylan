-- Xero drafts — Phase 3: tag each transaction suggestion with its provider.
--
-- The draft pipeline (quickbooks_transaction_suggestions) is now SHARED between
-- QuickBooks- and Xero-connected clients: a receipt on a Xero client's
-- engagement produces the same kind of draft, built from the Xero cached lists
-- (Phase 2's readCachedXeroListsForFirm adapts them to the same QuickbooksLists
-- shape the matcher consumes). A client connects EITHER QuickBooks OR Xero (never
-- both — already enforced), so a draft's provider is fully determined by its
-- client's connection.
--
-- This adds a single `provider` column to the SHARED suggestions table (NOT a
-- sibling table): the draft card + firm-wide queue read it to show Xero branding
-- and to gate the Post/Undo controls (posting stays QuickBooks-only in Phase 3;
-- Xero posting is Phase 4). Defaults to 'quickbooks' so every existing row (and
-- any row written before this migration is applied) reads as a QuickBooks draft.
--
-- The existing RLS policies + grants on quickbooks_transaction_suggestions cover
-- this column already (firm members SELECT their own firm's rows; writes are
-- service-role) — no policy/grant changes needed.
--
-- Additive + reversible (down: drop the column).

alter table quickbooks_transaction_suggestions
  add column if not exists provider text not null default 'quickbooks'
    check (provider in ('quickbooks', 'xero'));
