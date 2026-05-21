-- Vylan — built-in engagement templates.
--
-- A row with firm_id = null is a shared, built-in template. Any firm can
-- read these (see templates_select policy in 0002). To customize, a firm
-- clones a built-in into their own scoped row.
--
-- The `items` jsonb is an array of:
--   { label_fr, label_en, description_fr, description_en, doc_type, required }
-- order_index is implicit from array position.

insert into templates (id, firm_id, name, type, items) values
  (
    '00000000-0000-0000-0000-000000000001',
    null,
    'T1 — Particulier',
    't1',
    $$[
      {"label_fr":"T4 — Relevé d’emploi","label_en":"T4 — Statement of remuneration",
       "description_fr":"Tous vos T4 d’employeurs au Canada.","description_en":"All T4 slips from Canadian employers.",
       "doc_type":"t4","required":true},
      {"label_fr":"RL-1 — Revenus d’emploi (Québec)","label_en":"RL-1 — Quebec employment income",
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
      {"label_fr":"Cotisations REER","label_en":"RRSP contribution slips",
       "description_fr":"Reçus officiels pour les 60 premiers jours et le reste de l’année.","description_en":"Official slips for first-60-days and the rest of the year.",
       "doc_type":"rrsp","required":false},
      {"label_fr":"Reçus médicaux","label_en":"Medical receipts",
       "description_fr":"Frais admissibles : dentiste, optométriste, pharmacie, etc.","description_en":"Eligible expenses: dentist, optometrist, pharmacy, etc.",
       "doc_type":"medical","required":false},
      {"label_fr":"Reçus de dons","label_en":"Donation receipts",
       "description_fr":"Reçus officiels d’organismes de bienfaisance enregistrés.","description_en":"Official receipts from registered charities.",
       "doc_type":"donation","required":false},
      {"label_fr":"T2202 — Frais de scolarité","label_en":"T2202 — Tuition slip",
       "description_fr":"Émis par l’établissement post-secondaire.","description_en":"Issued by the post-secondary institution.",
       "doc_type":"t2202","required":false},
      {"label_fr":"Sommaire des revenus locatifs","label_en":"Rental income summary",
       "description_fr":"Revenus et dépenses pour chaque propriété louée.","description_en":"Income and expenses for each rental property.",
       "doc_type":"rental","required":false},
      {"label_fr":"Avis de cotisation de l’an dernier","label_en":"Prior-year Notice of Assessment",
       "description_fr":"Pour reporter les pertes, REER inutilisés, etc.","description_en":"Needed to carry forward losses, unused RRSP room, etc.",
       "doc_type":"noa","required":true},
      {"label_fr":"RL-31 — Solidarité (loyer/impôt foncier)","label_en":"RL-31 — Solidarity (rent/property tax)",
       "description_fr":"Délivré par votre propriétaire (Québec).","description_en":"Issued by your landlord (Quebec).",
       "doc_type":"other","required":false},
      {"label_fr":"Reçus de frais de garde","label_en":"Childcare receipts",
       "description_fr":"Garderie, camp de jour, après l’école.","description_en":"Daycare, day camp, after-school care.",
       "doc_type":"receipt","required":false},
      {"label_fr":"Frais de déménagement","label_en":"Moving expenses",
       "description_fr":"Si vous avez déménagé pour le travail ou l’école (>40 km).","description_en":"If you moved for work or school (>40 km).",
       "doc_type":"receipt","required":false}
    ]$$::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    null,
    'T2 — Société',
    't2',
    $$[
      {"label_fr":"Balance de vérification","label_en":"Trial balance",
       "description_fr":"Au dernier jour de l’exercice.","description_en":"As of the fiscal year end.",
       "doc_type":"trial_balance","required":true},
      {"label_fr":"Grand livre (export)","label_en":"General ledger (export)",
       "description_fr":"Export complet pour l’exercice (PDF ou Excel).","description_en":"Full ledger export for the fiscal year (PDF or Excel).",
       "doc_type":"gl_export","required":true},
      {"label_fr":"Relevés bancaires (tous les mois)","label_en":"Bank statements (all months)",
       "description_fr":"12 mois pour tous les comptes d’opérations.","description_en":"All 12 months for every operating account.",
       "doc_type":"bank_statement","required":true},
      {"label_fr":"États financiers de l’an dernier","label_en":"Prior-year financial statements",
       "doc_type":"financials","required":true},
      {"label_fr":"Déclarations TPS/TVH/TVQ","label_en":"GST/HST/QST filings",
       "description_fr":"Toutes les déclarations produites pendant l’exercice.","description_en":"All filings produced during the fiscal year.",
       "doc_type":"gst_hst_qst","required":true},
      {"label_fr":"Activité prêts/avances aux actionnaires","label_en":"Shareholder loan / advances activity",
       "doc_type":"shareholder_loan","required":false},
      {"label_fr":"Sommaire T4 — paie","label_en":"T4 summary — payroll",
       "doc_type":"payroll_summary","required":false},
      {"label_fr":"Sommaire RL-1 — paie (Québec)","label_en":"RL-1 summary — payroll (Quebec)",
       "doc_type":"payroll_summary","required":false},
      {"label_fr":"Ajouts/dispositions d’immobilisations","label_en":"Capital asset additions/disposals",
       "description_fr":"Factures d’achat ou actes de vente.","description_en":"Purchase invoices or sale agreements.",
       "doc_type":"capital_asset","required":false},
      {"label_fr":"Inventaire de fin d’exercice","label_en":"Fiscal year-end inventory",
       "doc_type":"inventory","required":false}
    ]$$::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    null,
    'Tenue de livres — mensuel',
    'bookkeeping',
    $$[
      {"label_fr":"Relevés bancaires","label_en":"Bank statements",
       "description_fr":"Tous les comptes pour le mois.","description_en":"All accounts for the month.",
       "doc_type":"bank_statement","required":true},
      {"label_fr":"Relevés de carte de crédit","label_en":"Credit card statements",
       "doc_type":"credit_card_statement","required":true},
      {"label_fr":"Factures de vente","label_en":"Sales invoices",
       "doc_type":"invoice","required":true},
      {"label_fr":"Reçus de dépenses","label_en":"Expense receipts",
       "doc_type":"receipt","required":true},
      {"label_fr":"Rapports de paie","label_en":"Payroll reports",
       "doc_type":"payroll_summary","required":false}
    ]$$::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    null,
    'Personnalisé',
    'custom',
    '[]'::jsonb
  )
on conflict (id) do update set
  name = excluded.name,
  type = excluded.type,
  items = excluded.items;
