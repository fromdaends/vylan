-- Onboarding template tidy: the built-in "New client onboarding" template
-- (id ...000a, seeded in 0170) lists two Quebec-specific lines that carry a
-- GENERIC doc_type, so the province / include-Quebec-forms filter (0350) does
-- not drop them for a non-Quebec firm:
--   * "Notice of Assessment — Quebec (Revenu Québec)"  (doc_type noa)
--   * "Signed Revenu Québec authorization (MR-69)"     (doc_type other)
--
-- Flag those two items quebec_only so they follow the same include/exclude rule
-- as the RL slips. They are the ONLY onboarding items whose English label
-- contains "Revenu" (ASCII-safe match, no accented chars needed). The federal
-- equivalents already on the template (CRA NOA, AUT-01) are untouched.
--
-- Idempotent (re-running re-sets the same flag) and reversible (down: strip the
-- quebec_only key). Built-in only (firm_id is null); firm clones are untouched.
update templates
set items = (
  select jsonb_agg(
    case
      when elem->>'label_en' like '%Revenu%'
      then elem || '{"quebec_only": true}'::jsonb
      else elem
    end
  )
  from jsonb_array_elements(items) elem
)
where id = '00000000-0000-0000-0000-00000000000a'
  and firm_id is null;
