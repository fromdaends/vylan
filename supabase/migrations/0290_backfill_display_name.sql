-- 0290_backfill_display_name.sql
--
-- ONE-TIME backfill of uploaded_files.display_name for documents the AI had
-- already classified BEFORE auto-naming shipped (migration 0280 + the feature).
-- New uploads are named by the classify worker; this names the existing ones.
--
-- It mirrors src/lib/ai/display-name.ts buildDisplayName(): the doc-type short
-- label (generated from DOC_TYPE_LABELS below) + the extracted year + the
-- issuer (else party) name it read, gated on ai_confidence >= 0.5 and a known,
-- non-"other"/"unknown" type. Accents are preserved (matches the stored name).
--
-- SAFE: idempotent (only fills NULLs, so re-running is a no-op) and additive.
-- To fully revert: update uploaded_files set display_name = null;
--
-- Note: the reserved-character strip drops backslash (vs the app, which also
-- strips it) so the SQL stays robust regardless of standard_conforming_strings;
-- real issuer/party names never contain one.

with src as (
  select
    uf.id,
    (case uf.ai_classification
         when 't4' then 'T4'
         when 't4a' then 'T4A'
         when 't4a_oas' then 'T4A(OAS)'
         when 't4a_p' then 'T4A(P)'
         when 't4e' then 'T4E'
         when 't4rsp' then 'T4RSP'
         when 't4rif' then 'T4RIF'
         when 't5' then 'T5'
         when 't5008' then 'T5008'
         when 't5013' then 'T5013'
         when 't3' then 'T3'
         when 'nr4' then 'NR4'
         when 'rl1' then 'RL-1'
         when 'rl2' then 'RL-2'
         when 'rl3' then 'RL-3'
         when 'rl5' then 'RL-5'
         when 'rl6' then 'RL-6'
         when 'rl7' then 'RL-7'
         when 'rl8' then 'RL-8'
         when 'rl10' then 'RL-10'
         when 'rl15' then 'RL-15'
         when 'rl16' then 'RL-16'
         when 'rl18' then 'RL-18'
         when 'rl19' then 'RL-19'
         when 'rl24' then 'RL-24'
         when 'rl25' then 'RL-25'
         when 'rl26' then 'RL-26'
         when 'rl27' then 'RL-27'
         when 'rl31' then 'RL-31'
         when 'rl32' then 'RL-32'
         when 'rrsp' then 'RRSP contribution receipt'
         when 'fhsa' then 'FHSA'
         when 't2202' then 'T2202'
         when 'medical' then 'Medical receipts'
         when 'donation' then 'Donation receipts'
         when 't1135' then 'T1135'
         when 't2125' then 'T2125'
         when 't2200' then 'T2200'
         when 't2091' then 'T2091'
         when 't2201' then 'T2201'
         when 'noa' then 'Notice of Assessment'
         when 'bank_statement' then 'Bank statements'
         when 'credit_card_statement' then 'Credit card statements'
         when 'invoice' then 'Sales invoices'
         when 'receipt' then 'Expense receipts'
         when 'gst_hst_qst' then 'GST/HST/QST filings'
         when 'rental' then 'Rental income summary'
         when 'trial_balance' then 'Trial balance'
         when 'gl_export' then 'General ledger (export)'
         when 'financials' then 'Financial statements'
         when 'shareholder_loan' then 'Shareholder loan / advances'
         when 'payroll_summary' then 'Payroll summary (T4 / RL-1)'
         when 'capital_asset' then 'Capital asset additions / disposals'
         when 'inventory' then 'Year-end inventory'
         else null
     end) as label,
    case
      when jsonb_typeof(uf.ai_extracted_fields -> 'extracted_year') = 'number'
      then uf.ai_extracted_fields ->> 'extracted_year'
      else null
    end as yr,
    coalesce(
      nullif(btrim(left(btrim(
        regexp_replace(regexp_replace(regexp_replace(
          coalesce(uf.ai_extracted_fields ->> 'issuer_name', ''),
          '[[:cntrl:]]', '', 'g'), '[/<>:"|?*]', ' ', 'g'), '[[:space:]]+', ' ', 'g')
      ), 48)), ''),
      nullif(btrim(left(btrim(
        regexp_replace(regexp_replace(regexp_replace(
          coalesce(uf.ai_extracted_fields ->> 'party_name', ''),
          '[[:cntrl:]]', '', 'g'), '[/<>:"|?*]', ' ', 'g'), '[[:space:]]+', ' ', 'g')
      ), 48)), '')
    ) as who,
    case
      when uf.original_filename ~ '[.][A-Za-z0-9]{1,8}$'
      then lower(substring(uf.original_filename from '[.][A-Za-z0-9]{1,8}$'))
      else ''
    end as ext
  from uploaded_files uf
  where uf.display_name is null
    and uf.ai_classification is not null
    and coalesce(uf.ai_confidence, 0) >= 0.5
)
update uploaded_files uf
set display_name =
  src.label
  || coalesce(' - ' || src.yr, '')
  || coalesce(' - ' || src.who, '')
  || src.ext
from src
where src.id = uf.id
  and src.label is not null;
