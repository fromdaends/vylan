-- Auto-naming of scanned uploads.
--
-- When the AI classifier reads a document and is confident what it is, the
-- worker (processClassifyJob) writes a clean, human display name here — e.g.
-- "T4 - 2024 - Hydro-Quebec.pdf" — built from the doc-type short label + the
-- extracted year + the issuer/party it read off the page. The accountant sees
-- this name in the engagement file list and gets it on single-file + bulk
-- (ZIP) downloads. The client portal keeps showing the file the client
-- actually uploaded (its original_filename).
--
-- NULL is the meaningful default: the AI was unsure (low confidence / unknown
-- type) or the file hasn't been classified yet, so callers fall back to
-- original_filename. Re-classifying recomputes it (and can clear it back to
-- NULL), so the stored name always tracks the latest verdict.
--
-- Written by the service-role worker only (no accountant ever UPDATEs it
-- directly), so no column-level grant is needed — it's read through the same
-- RLS select policies as the rest of the row. Additive + idempotent.
alter table uploaded_files
  add column if not exists display_name text;
