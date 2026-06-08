-- Signature items.
--
-- Prompt B Phase 1 — data model only (no UI, no TypeScript). A "signature" is a
-- new KIND of checklist item: instead of the client PROVIDING a document, the
-- accountant supplies a document and the client returns a SIGNED copy. We ride
-- entirely on the existing request_items / uploaded_files / status machinery;
-- this migration only adds (a) a marker for the item kind and (b) a place to
-- keep the blank document the accountant uploads to be signed.
--
-- Everything is additive with safe defaults. No existing row or column is
-- mutated: every current item becomes kind = 'collection' (its real meaning),
-- and the signing_doc_* columns are null for non-signature items.
--
-- The client's SIGNED copy is a normal uploaded_files row under the item, kept
-- SEPARATE from these columns, so the status roll-up (deriveItemStatus, which
-- counts only the client's returned files) is unchanged.
--
-- Vylan does NOT generate, draw, or certify a signature and makes NO claim of
-- legal / electronic-signature validity. These columns only transport the
-- document the client signs by their own means. (See Prompt B section 5.)
--
-- RLS: request_items already has the table-level, firm-scoped `request_items_all`
-- policy (0002_rls.sql), so the new columns inherit it and no policy change is
-- needed.
--
-- Reversible:
--   alter table request_items
--     drop column if exists signing_doc_mime,
--     drop column if exists signing_doc_name,
--     drop column if exists signing_doc_path,
--     drop column if exists kind;
--   drop type if exists request_item_kind;

-- (a) Item kind. Existing rows are all document-collection items. The do-block
-- makes the type creation idempotent (CREATE TYPE has no IF NOT EXISTS).
do $$ begin
  create type request_item_kind as enum ('collection', 'signature');
exception
  when duplicate_object then null;
end $$;

alter table request_items
  add column if not exists kind request_item_kind not null default 'collection';

-- (b) The blank document the accountant uploads to be signed. Stored in the
-- existing private `client-uploads` bucket under the engagement/item prefix
-- (same firm-scoped storage paths as client uploads). Null for collection items.
alter table request_items
  add column if not exists signing_doc_path text;
alter table request_items
  add column if not exists signing_doc_name text;
alter table request_items
  add column if not exists signing_doc_mime text;
