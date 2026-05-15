-- Phase 4: append T1135 + T2125 to the built-in T1 template so accountants
-- creating a T1 engagement get these two line items by default. Both are
-- optional (`required: false`) — most clients don't need them, but having
-- them in the checklist surfaces the question.
--
-- The doc_type values referenced here must already exist in the enum;
-- that's guaranteed by migration 0049 running first.

update templates
set items = items || $$[
  {
    "label_fr": "T1135 — Vérification du revenu étranger",
    "label_en": "T1135 — Foreign Income Verification",
    "description_fr": "Obligatoire si vous déteniez plus de 100 000 $ CAD de biens étrangers à un moment de l'année.",
    "description_en": "Required if you held more than CAD $100,000 in foreign property at any time during the year.",
    "doc_type": "t1135",
    "required": false
  },
  {
    "label_fr": "T2125 — Revenus d'entreprise ou de profession",
    "label_en": "T2125 — Statement of Business or Professional Activities",
    "description_fr": "Pour les revenus de travail autonome, pige, ou petite entreprise.",
    "description_en": "For self-employment, freelance, or small-business income.",
    "doc_type": "t2125",
    "required": false
  }
]$$::jsonb
where id = '00000000-0000-0000-0000-000000000001';
