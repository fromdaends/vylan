-- 0300_backfill_display_name_generic.sql
--
-- Follow-up to 0290: that backfill (like the original auto-naming feature)
-- only named files whose classified type was confident and catalogued,
-- leaving every unknown / "other" / low-confidence upload showing the
-- client's raw filename ("IMG_2931.jpg"). The naming rule has changed
-- (founder decision: every AI-checked file gets a clean name, even wrong or
-- unidentifiable ones — see src/lib/ai/display-name.ts), so this names the
-- remainder with the same generic format the app now writes:
--   'Document' + ' - <extracted year>' + ' - <issuer or party>' + '<.ext>'
-- e.g. "Document - 2024 - Desjardins.pdf", or just "Document.pdf" when the
-- AI could read nothing.
--
-- Never-classified rows (ai_classification IS NULL — AI was off, skipped, or
-- still queued) are left untouched: with no AI read there is nothing honest
-- to name them from, and the classify worker names them when it runs.
--
-- SAFE: data-only (no schema change), idempotent (fills NULLs only, so
-- re-running is a no-op), and independent of deploy order — the app treats
-- display_name as display-only and always falls back to original_filename.
-- To fully revert all auto-names: update uploaded_files set display_name = null;
--
-- The trailing '[. ]+$' trim mirrors the app: an issuer like "Maple Tech
-- Inc." must not produce "… Inc..pdf" (and Windows rejects trailing dots).

with src as (
  select
    uf.id,
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
)
update uploaded_files uf
set display_name =
  regexp_replace(
    'Document'
    || coalesce(' - ' || src.yr, '')
    || coalesce(' - ' || src.who, ''),
    '[. ]+$', '')
  || src.ext
from src
where src.id = uf.id;
