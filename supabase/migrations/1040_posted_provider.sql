-- Which accounting system a posted draft was ACTUALLY written to.
--
-- THE BUG THIS FIXES. Undo and receipt-attach both chose their provider by asking
-- "is this client Xero-connected RIGHT NOW?" (isClientXeroConnected), never by
-- what the transaction was posted to. posted_realm_id already records the target
-- COMPANY, but it holds a QuickBooks realmId ("123456789") and a Xero tenantId (a
-- UUID) in the same text column with nothing saying which is which.
--
-- So a client posted under QuickBooks who later connects Xero sends every Undo to
-- xeroDeleteBankTransaction with a numeric QuickBooks id (and the reverse sends a
-- Xero UUID to quickbooksDelete). It fails rather than deleting the wrong record —
-- the id shapes cannot collide — but the draft stays 'posted', the entry stays in
-- the client's books, and there is no way back from inside Vylan. That became
-- materially worse when Xero posting was opened to real client books (#1036):
-- the stranded entry is now in a real ledger.
--
-- The 0790 `provider` column does NOT answer this. It records which pipeline the
-- draft was CREATED for (resolveBookkeepingProvider at classify time), so it moves
-- with the client's connection and says nothing about where a write landed.

alter table public.quickbooks_transaction_suggestions
  add column if not exists posted_provider text;

-- Only ever 'quickbooks' or 'xero'; NULL means "not recorded" (a row posted before
-- this migration), which the app reads as "fall back to the connection check".
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quickbooks_transaction_suggestions_posted_provider_check'
  ) then
    alter table public.quickbooks_transaction_suggestions
      add constraint quickbooks_transaction_suggestions_posted_provider_check
      check (posted_provider is null or posted_provider in ('quickbooks', 'xero'));
  end if;
end $$;

-- BACKFILL — from posted_realm_id's SHAPE only, which is strong evidence: a Xero
-- tenantId is a UUID and a QuickBooks realmId is all digits, and neither system
-- can produce the other's format.
--
-- Rows with a NULL posted_realm_id (posted before 0520) are DELIBERATELY LEFT
-- NULL. The only other signal available is the 0790 provider column, which is
-- connection-derived and could be wrong; guessing there would LOCK IN a bad
-- dispatch, whereas NULL keeps today's connection-check behaviour — no fix, but
-- no regression either.
update public.quickbooks_transaction_suggestions
set posted_provider = case
      when posted_realm_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then 'xero'
      when posted_realm_id ~ '^[0-9]+$'
        then 'quickbooks'
    end
where posted_provider is null
  and posted_qbo_id is not null
  and posted_realm_id is not null
  and (
    posted_realm_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or posted_realm_id ~ '^[0-9]+$'
  );

comment on column public.quickbooks_transaction_suggestions.posted_provider is
  'The accounting system this draft was actually posted to (quickbooks|xero). Undo and receipt-attach dispatch on THIS, not on the client''s current connection. NULL = posted before 1040, or an unrecognised posted_realm_id shape; callers then fall back to the live connection check.';
