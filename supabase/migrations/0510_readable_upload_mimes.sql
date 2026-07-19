-- Vylan — allow machine-readable document uploads (spreadsheets + CSV).
--
-- The code-readable fast path (src/lib/ai/readable-extract.ts) reads text-layer
-- PDFs, Excel workbooks, and CSV files WITHOUT the vision model. PDFs were
-- already accepted; this widens the client-uploads bucket's MIME allow-list so
-- Excel/CSV can flow through the portal too. Kept in sync with ALLOWED_MIMES in
-- src/lib/storage.ts (the app-level check) — both must list the same types.
--
-- Set the full desired list (idempotent) rather than appending, so re-running
-- can never leave duplicates.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel', -- legacy .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' -- .xlsx
]
where id = 'client-uploads';
