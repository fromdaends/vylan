-- Filed-copy removal (founder decision, 2026-07-27).
--
-- Deleting a document in Vylan can now ALSO — with an explicit per-delete
-- confirmation — move the copy Vylan previously filed into the storage
-- provider's TRASH (Drive trash / SharePoint recycle bin; recoverable, never
-- a permanent delete). This deliberately relaxes the original "Vylan never
-- deletes from the firm's storage" guardrail for exactly one user-confirmed
-- case; the connector-level capability is trash-by-id of ledger-verified
-- Vylan-filed files ONLY.
--
-- Schema: the ledger's status check gains 'removed', plus removal audit
-- columns. A 'removed' row leaves the filed_documents_filed_once partial
-- unique index's scope (WHERE status = 'filed'), which is correct: the file
-- row it pointed at was deleted in Vylan in the same act, so the file id can
-- never be re-filed anyway.
--
-- Additive + reversible. Down:
--   alter table filed_documents drop constraint filed_documents_status_check;
--   alter table filed_documents add constraint filed_documents_status_check
--     check (status in ('uploading', 'filed', 'skipped', 'failed'));
--   alter table filed_documents
--     drop column if exists removed_at, drop column if exists removed_by;

alter table filed_documents
  drop constraint if exists filed_documents_status_check;
alter table filed_documents
  add constraint filed_documents_status_check
  check (status in ('uploading', 'filed', 'skipped', 'failed', 'removed'));

alter table filed_documents
  add column if not exists removed_at timestamptz;
alter table filed_documents
  add column if not exists removed_by uuid references users(id) on delete set null;
