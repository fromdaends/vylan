-- Built-in T1 template corrections + additions. Supersedes the items array set
-- by 0129 (which itself superseded 0005 + 0050). MUST run after 0149, because
-- it references the new enum values 'rl31', 't4a', and 'rl2'.
--
-- Changes vs 0129:
--   1. T4 French label was "T4 — Relevé d'emploi" — WRONG. "Relevé d'emploi"
--      is the Record of Employment (ROE), a separate Service Canada form. The
--      T4's official French name is "État de la rémunération payée".
--      Source: https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t4.html
--   2. RL-31 now uses the dedicated 'rl31' doc_type (was overloaded onto
--      'other'), so the AI can recognize it and it groups with the other RL
--      slips in the picker.
--   3. Added T4A (federal) + RL-2 (Quebec) as optional items — very common
--      retirement/pension income slips that were absent from the default T1
--      checklist.
--
-- Firm-cloned templates are NOT touched (firms keep their customised copies).

update templates
set items = $$[
  {"label_fr":"T4 — État de la rémunération payée","label_en":"T4 — Statement of remuneration",
   "description_fr":"Tous vos T4 d'employeurs au Canada.","description_en":"All T4 slips from Canadian employers.",
   "doc_type":"t4","required":true},
  {"label_fr":"RL-1 — Revenus d'emploi (Québec)","label_en":"RL-1 — Quebec employment income",
   "description_fr":"Tous vos RL-1 (équivalent québécois du T4).","description_en":"Quebec RL-1 slips (provincial equivalent of T4).",
   "doc_type":"rl1","required":true},
  {"label_fr":"T5 — Revenus de placement","label_en":"T5 — Investment income",
   "description_fr":"Intérêts, dividendes (banque, courtier, etc.).","description_en":"Interest, dividends (bank, broker, etc.).",
   "doc_type":"t5","required":false},
  {"label_fr":"RL-3 — Revenus de placement (Québec)","label_en":"RL-3 — Quebec investment income",
   "description_fr":"Équivalent québécois du T5.","description_en":"Quebec equivalent of T5.",
   "doc_type":"rl3","required":false},
  {"label_fr":"T3 — Revenus de fiducie","label_en":"T3 — Trust income",
   "description_fr":"Fonds communs, fiducies, FNB.","description_en":"Mutual funds, trusts, ETFs.",
   "doc_type":"t3","required":false},
  {"label_fr":"RL-16 — Revenus de fiducie (Québec)","label_en":"RL-16 — Quebec trust income",
   "doc_type":"rl16","required":false},
  {"label_fr":"T4A — Revenus de pension, de retraite ou autres","label_en":"T4A — Pension, retirement & other income",
   "description_fr":"Pensions, rentes, commissions de travail autonome, honoraires.","description_en":"Pensions, annuities, self-employed commissions, fees.",
   "doc_type":"t4a","required":false},
  {"label_fr":"RL-2 — Revenus de retraite et rentes (Québec)","label_en":"RL-2 — Quebec retirement & annuity income",
   "description_fr":"Équivalent québécois du T4A / T4RSP / T4RIF.","description_en":"Quebec equivalent of the T4A / T4RSP / T4RIF.",
   "doc_type":"rl2","required":false},
  {"label_fr":"Cotisations REER","label_en":"RRSP contribution slips",
   "description_fr":"Reçus officiels pour les 60 premiers jours et le reste de l'année.","description_en":"Official slips for first-60-days and the rest of the year.",
   "doc_type":"rrsp","required":false},
  {"label_fr":"Reçus médicaux","label_en":"Medical receipts",
   "description_fr":"Frais admissibles : dentiste, optométriste, pharmacie, etc.","description_en":"Eligible expenses: dentist, optometrist, pharmacy, etc.",
   "doc_type":"medical","required":false},
  {"label_fr":"Reçus de dons","label_en":"Donation receipts",
   "description_fr":"Reçus officiels d'organismes de bienfaisance enregistrés.","description_en":"Official receipts from registered charities.",
   "doc_type":"donation","required":false},
  {"label_fr":"T2202 — Frais de scolarité","label_en":"T2202 — Tuition and Enrolment Certificate",
   "description_fr":"Émis par l'établissement post-secondaire.","description_en":"Issued by the post-secondary institution.",
   "doc_type":"t2202","required":false},
  {"label_fr":"Sommaire des revenus locatifs","label_en":"Rental income summary",
   "description_fr":"Revenus et dépenses pour chaque propriété louée.","description_en":"Income and expenses for each rental property.",
   "doc_type":"rental","required":false},
  {"label_fr":"Avis de cotisation de l'an dernier","label_en":"Prior-year Notice of Assessment",
   "description_fr":"Pour reporter les pertes, REER inutilisés, etc.","description_en":"Needed to carry forward losses, unused RRSP room, etc.",
   "doc_type":"noa","required":true},
  {"label_fr":"RL-31 — Solidarité (loyer/impôt foncier)","label_en":"RL-31 — Solidarity (rent/property tax)",
   "description_fr":"Délivré par votre propriétaire (Québec). Sert au crédit d'impôt pour solidarité.","description_en":"Issued by your landlord (Quebec). Used for the solidarity tax credit claim.",
   "doc_type":"rl31","required":false},
  {"label_fr":"Reçus de frais de garde","label_en":"Childcare receipts",
   "description_fr":"Garderie, camp de jour, après l'école.","description_en":"Daycare, day camp, after-school care.",
   "doc_type":"receipt","required":false},
  {"label_fr":"Frais de déménagement","label_en":"Moving expenses",
   "description_fr":"Si votre nouveau domicile est au moins 40 km plus près de votre nouveau lieu de travail ou d'études que l'ancien.","description_en":"If your new home is at least 40 km closer to your new workplace or school than your old home was.",
   "doc_type":"receipt","required":false},
  {
    "label_fr": "T1135 — Vérification du revenu étranger",
    "label_en": "T1135 — Foreign Income Verification Statement",
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
where id = '00000000-0000-0000-0000-000000000001'
  and firm_id is null;
