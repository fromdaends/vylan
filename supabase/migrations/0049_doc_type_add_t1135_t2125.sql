-- Phase 4: enable T1135 + T2125 as values in the doc_type enum.
--
-- T1135 = Foreign Income Verification Statement (CRA form for foreign
--         property over CAD $100,000 during the year).
-- T2125 = Statement of Business or Professional Activities
--         (self-employment income).
--
-- Must be its own migration: Postgres forbids using a freshly-added enum
-- value in the same transaction that added it. The T1 template update
-- that inserts these values into the built-in template lives in 0050.

alter type doc_type add value if not exists 't1135';
alter type doc_type add value if not exists 't2125';
