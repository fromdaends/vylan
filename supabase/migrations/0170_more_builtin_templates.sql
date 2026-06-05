-- Vylan — six more built-in engagement templates.
--
-- Same shape as 0005: firm_id = null means a shared, built-in template any firm
-- can read and clone. `items` is a jsonb array of
--   { label_fr, label_en, description_fr?, description_en?, doc_type, required }
-- and order_index is implicit from array position.
--
-- These map onto the EXISTING engagement `type` values (t1 / bookkeeping /
-- custom) on purpose, so no app code, gallery tabs, or type unions need to
-- change — the gallery shows every built-in (firm_id null, minus the blank id)
-- under "Recommended" automatically. Every `doc_type` below is a valid value of
-- the doc_type enum (0001 + 0049 + 0149).
--
-- New ids continue the sequence: 0005..000a (0001-0004 were seeded in 0005).

insert into templates (id, firm_id, name, type, items) values
  -- 1) Self-employed / sole proprietor (filed on the personal T1 via T2125).
  (
    '00000000-0000-0000-0000-000000000005',
    null,
    'Travailleur autonome (T2125)',
    't1',
    $$[
      {"label_fr":"Avis de cotisation de l'an dernier","label_en":"Prior-year Notice of Assessment",
       "description_fr":"Fédéral et Québec, pour les reports (REER, pertes, etc.).","description_en":"Federal and Quebec, for carry-forwards (RRSP, losses, etc.).",
       "doc_type":"noa","required":true},
      {"label_fr":"Factures de vente / registre des revenus","label_en":"Sales invoices / revenue records",
       "description_fr":"Total des revenus d'entreprise pour l'année.","description_en":"Total business income for the year.",
       "doc_type":"invoice","required":true},
      {"label_fr":"Relevés bancaires d'entreprise","label_en":"Business bank statements",
       "doc_type":"bank_statement","required":true},
      {"label_fr":"Reçus de dépenses d'entreprise","label_en":"Business expense receipts",
       "description_fr":"Fournitures, publicité, déplacements, télécom, etc.","description_en":"Supplies, advertising, travel, telecom, etc.",
       "doc_type":"receipt","required":true},
      {"label_fr":"Frais de véhicule — registre + reçus","label_en":"Vehicle expenses — mileage log + receipts",
       "description_fr":"Kilométrage affaires/total, essence, entretien, assurance, immatriculation.","description_en":"Business/total km, gas, maintenance, insurance, registration.",
       "doc_type":"receipt","required":false},
      {"label_fr":"Bureau à domicile","label_en":"Home-office expenses",
       "description_fr":"Superficie du bureau vs. logement, loyer ou intérêts hypothécaires, services publics.","description_en":"Office vs. home square footage, rent or mortgage interest, utilities.",
       "doc_type":"other","required":false},
      {"label_fr":"T4A — honoraires / autres revenus","label_en":"T4A — fees / other income",
       "doc_type":"t4a","required":false},
      {"label_fr":"TPS/TVQ — déclarations (si inscrit)","label_en":"GST/QST filings (if registered)",
       "doc_type":"gst_hst_qst","required":false},
      {"label_fr":"Acquisitions d'immobilisations (pour la DPA)","label_en":"Capital asset purchases (for CCA)",
       "description_fr":"Équipement, matériel, véhicule — factures d'achat.","description_en":"Equipment, tools, vehicle — purchase invoices.",
       "doc_type":"capital_asset","required":false},
      {"label_fr":"Paiements à des sous-traitants (T5018)","label_en":"Subcontractor payments (T5018)",
       "doc_type":"other","required":false},
      {"label_fr":"Cotisations REER","label_en":"RRSP contributions",
       "doc_type":"rrsp","required":false},
      {"label_fr":"T4 / RL-1 (si aussi salarié)","label_en":"T4 / RL-1 (if also employed)",
       "doc_type":"t4","required":false}
    ]$$::jsonb
  ),
  -- 2) Rental property (T776 — reported on the personal T1).
  (
    '00000000-0000-0000-0000-000000000006',
    null,
    'Revenus de location (T776)',
    't1',
    $$[
      {"label_fr":"Avis de cotisation de l'an dernier","label_en":"Prior-year Notice of Assessment",
       "doc_type":"noa","required":true},
      {"label_fr":"Sommaire des revenus de loyer (par immeuble)","label_en":"Rental income summary (per property)",
       "description_fr":"Loyers perçus pour chaque logement/immeuble.","description_en":"Rent collected for each unit/property.",
       "doc_type":"rental","required":true},
      {"label_fr":"Intérêts hypothécaires (relevé annuel)","label_en":"Mortgage interest (annual statement)",
       "description_fr":"Relevé du prêteur — la portion intérêts seulement.","description_en":"Lender statement — interest portion only.",
       "doc_type":"other","required":true},
      {"label_fr":"Taxes municipales et scolaires","label_en":"Municipal & school taxes",
       "doc_type":"other","required":true},
      {"label_fr":"Assurance de l'immeuble","label_en":"Property insurance",
       "doc_type":"receipt","required":false},
      {"label_fr":"Services publics (si payés par le propriétaire)","label_en":"Utilities (if paid by owner)",
       "doc_type":"receipt","required":false},
      {"label_fr":"Frais de copropriété (condo)","label_en":"Condo fees",
       "doc_type":"receipt","required":false},
      {"label_fr":"Réparations et entretien","label_en":"Repairs & maintenance",
       "description_fr":"Reçus — distinguez réparations (déductibles) et améliorations (capital).","description_en":"Receipts — separate repairs (deductible) from improvements (capital).",
       "doc_type":"receipt","required":false},
      {"label_fr":"Frais de gestion / honoraires","label_en":"Management & professional fees",
       "doc_type":"invoice","required":false},
      {"label_fr":"Achat ou vente de l'immeuble (acte, relevé de clôture)","label_en":"Property purchase or sale (deed, closing statement)",
       "description_fr":"Seulement si l'immeuble a été acquis ou vendu durant l'année.","description_en":"Only if the property was bought or sold during the year.",
       "doc_type":"other","required":false}
    ]$$::jsonb
  ),
  -- 3) Final return for a deceased person.
  (
    '00000000-0000-0000-0000-000000000007',
    null,
    'Déclaration finale (succession)',
    't1',
    $$[
      {"label_fr":"Certificat de décès","label_en":"Death certificate",
       "doc_type":"other","required":true},
      {"label_fr":"Testament","label_en":"Will",
       "doc_type":"other","required":true},
      {"label_fr":"Avis de cotisation de l'an dernier","label_en":"Prior-year Notice of Assessment",
       "doc_type":"noa","required":true},
      {"label_fr":"Feuillets jusqu'à la date du décès (T4 / T4A / T5 / RL)","label_en":"Slips up to the date of death (T4 / T4A / T5 / RL)",
       "description_fr":"Tous les revenus gagnés jusqu'à la date du décès.","description_en":"All income earned up to the date of death.",
       "doc_type":"t4","required":true},
      {"label_fr":"Relevés REER / FERR à la date du décès","label_en":"RRSP / RRIF statements at date of death",
       "description_fr":"Juste valeur marchande au décès.","description_en":"Fair market value at death.",
       "doc_type":"t4rsp","required":false},
      {"label_fr":"Évaluation des biens à la date du décès","label_en":"Asset valuations at date of death",
       "description_fr":"Placements, immeubles, etc. (disposition réputée).","description_en":"Investments, real estate, etc. (deemed disposition).",
       "doc_type":"other","required":false},
      {"label_fr":"Reçus médicaux (frais finaux)","label_en":"Medical receipts (final expenses)",
       "doc_type":"medical","required":false},
      {"label_fr":"Coordonnées du liquidateur (exécuteur)","label_en":"Liquidator (executor) contact info",
       "doc_type":"other","required":false},
      {"label_fr":"Déclaration de revenus de l'an dernier","label_en":"Prior-year tax return",
       "doc_type":"other","required":false}
    ]$$::jsonb
  ),
  -- 4) GST/QST sales-tax filing (recurring compliance — bookkeeping bucket).
  (
    '00000000-0000-0000-0000-000000000008',
    null,
    'TPS/TVQ — Déclaration',
    'bookkeeping',
    $$[
      {"label_fr":"Ventes taxables de la période","label_en":"Taxable sales for the period",
       "description_fr":"Total des ventes assujetties à la taxe.","description_en":"Total tax-collectible sales.",
       "doc_type":"invoice","required":true},
      {"label_fr":"TPS/TVH/TVQ perçue","label_en":"GST/HST/QST collected",
       "doc_type":"gst_hst_qst","required":true},
      {"label_fr":"Reçus de dépenses (pour CTI/RTI)","label_en":"Expense receipts (for input tax credits)",
       "description_fr":"Pour réclamer les crédits de taxe sur intrants.","description_en":"To claim input tax credits.",
       "doc_type":"receipt","required":true},
      {"label_fr":"Relevés bancaires de la période","label_en":"Bank statements for the period",
       "doc_type":"bank_statement","required":false},
      {"label_fr":"Factures d'achat importantes","label_en":"Major purchase invoices",
       "doc_type":"invoice","required":false},
      {"label_fr":"Dernière déclaration TPS/TVQ produite","label_en":"Last GST/QST return filed",
       "doc_type":"gst_hst_qst","required":false}
    ]$$::jsonb
  ),
  -- 5) Trust / estate return (T3). Type 'custom' — no T1/T2 tag, name carries it.
  (
    '00000000-0000-0000-0000-000000000009',
    null,
    'Déclaration de fiducie (T3)',
    'custom',
    $$[
      {"label_fr":"Acte de fiducie / testament","label_en":"Trust deed / will",
       "doc_type":"other","required":true},
      {"label_fr":"États financiers de la fiducie","label_en":"Trust financial statements",
       "doc_type":"financials","required":true},
      {"label_fr":"Feuillets de revenus de la fiducie (T3 / T5 / T5008)","label_en":"Trust income slips (T3 / T5 / T5008)",
       "doc_type":"t3","required":true},
      {"label_fr":"RL-16 — Revenus de fiducie (Québec)","label_en":"RL-16 — Quebec trust income",
       "doc_type":"rl16","required":false},
      {"label_fr":"Relevés bancaires de la fiducie","label_en":"Trust bank statements",
       "doc_type":"bank_statement","required":true},
      {"label_fr":"Revenus de location (si applicable)","label_en":"Rental income (if any)",
       "doc_type":"rental","required":false},
      {"label_fr":"Distributions aux bénéficiaires","label_en":"Distributions to beneficiaries",
       "description_fr":"Montants versés et coordonnées des bénéficiaires.","description_en":"Amounts paid and beneficiary details.",
       "doc_type":"other","required":true},
      {"label_fr":"Avis de cotisation T3 de l'an dernier","label_en":"Prior-year T3 Notice of Assessment",
       "doc_type":"noa","required":false}
    ]$$::jsonb
  ),
  -- 6) New-client onboarding / authorizations. Type 'custom' — generic checklist.
  (
    '00000000-0000-0000-0000-00000000000a',
    null,
    'Accueil — nouveau client',
    'custom',
    $$[
      {"label_fr":"Déclaration de revenus de l'an dernier (T1 ou T2)","label_en":"Prior-year tax return (T1 or T2)",
       "description_fr":"Copie complète, telle que produite.","description_en":"Full copy, as filed.",
       "doc_type":"other","required":true},
      {"label_fr":"Avis de cotisation — fédéral (ARC)","label_en":"Notice of Assessment — federal (CRA)",
       "doc_type":"noa","required":true},
      {"label_fr":"Avis de cotisation — Québec (Revenu Québec)","label_en":"Notice of Assessment — Quebec (Revenu Québec)",
       "doc_type":"noa","required":true},
      {"label_fr":"Pièce d'identité avec photo","label_en":"Government-issued photo ID",
       "doc_type":"other","required":true},
      {"label_fr":"Autorisation ARC (AUT-01) signée","label_en":"Signed CRA authorization (AUT-01)",
       "description_fr":"Nous autorise à communiquer avec l'ARC en votre nom.","description_en":"Authorizes us to deal with the CRA on your behalf.",
       "doc_type":"other","required":true},
      {"label_fr":"Procuration Revenu Québec (MR-69) signée","label_en":"Signed Revenu Québec authorization (MR-69)",
       "description_fr":"Nous autorise à communiquer avec Revenu Québec.","description_en":"Authorizes us to deal with Revenu Québec.",
       "doc_type":"other","required":true},
      {"label_fr":"Spécimen de chèque (dépôt direct)","label_en":"Void cheque (direct deposit)",
       "doc_type":"other","required":false},
      {"label_fr":"Renseignements sur les personnes à charge","label_en":"Dependant information",
       "description_fr":"Noms, dates de naissance et NAS des personnes à charge.","description_en":"Names, dates of birth and SINs of dependants.",
       "doc_type":"other","required":false}
    ]$$::jsonb
  )
on conflict (id) do update set
  name = excluded.name,
  type = excluded.type,
  items = excluded.items;
