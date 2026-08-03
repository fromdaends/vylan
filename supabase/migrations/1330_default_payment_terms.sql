-- Default payment terms: how many days after issue a new invoice is due.
--
-- WHY THIS EXISTS. Billing (1310) shipped with an Overdue status, an Overdue
-- stat card, warning treatment on late rows, and a chase cadence anchored to
-- the due date. All of it was inert, because the due-date field on the invoice
-- builder starts blank and nothing filled it in — so no invoice ever had a due
-- date, nothing ever became overdue, the Overdue card sat at $0.00 forever, and
-- every chase email used the gentle "still outstanding" wording rather than
-- "this was due on the 15th".
--
-- The automated invoice path (lib/invoices/send.ts) was worse: it set an
-- issue_date and never a due_date, and nobody is watching that one at all.
--
-- 30 IS THE DEFAULT, AND IT APPLIES TO EXISTING FIRMS. Net 30 is the ordinary
-- term for an accounting practice, and a column default backfills every current
-- row, so the feature starts working without anyone visiting a settings page.
-- That is a deliberate behaviour change: invoices raised after this migration
-- carry a due date where invoices raised before it did not.
--
-- NULL MEANS "NO DUE DATE", not "use the default". A firm that genuinely does
-- not want to date its invoices can say so, and the Settings field is left
-- empty to express it. Nullable-with-a-default is the only shape that can
-- distinguish "never configured" (30, by backfill) from "configured to none".
--
-- 0 IS LEGAL AND MEANS DUE ON RECEIPT. It is a real commercial term, so the
-- bound starts at zero rather than one.
--
-- Migration number: 1310 was the highest applied (the Billing section);
-- `ls supabase/migrations | sed 's/_.*//' | sort | uniq -d` printed nothing
-- before this file was written, and is worth re-running after any merge.

alter table firm_invoice_settings
  add column if not exists default_due_days integer default 30
    check (default_due_days is null or default_due_days between 0 and 365);

comment on column firm_invoice_settings.default_due_days is
  'Days after issue that a new invoice is due. NULL = do not set a due date at all (distinct from 0, which means due on receipt). Only ever seeds a NEW invoice; editing this never moves an issued invoice''s date.';

-- Verify after applying — expect one row per firm, default_due_days = 30:
--   select firm_id, default_due_days from firm_invoice_settings;
