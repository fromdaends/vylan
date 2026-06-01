-- Expand the doc_type enum with the common federal + Quebec tax documents a
-- Quebec accounting firm actually encounters, fact-checked against CRA
-- (canada.ca) and Revenu Québec (revenuquebec.ca).
--
-- These new values are USED by 0150 (the built-in T1 template) and by the app.
-- They live in their OWN migration on purpose: Postgres will not let a newly
-- added enum value be referenced in the same transaction that added it, so the
-- "add values" step (this file) must commit before anything uses them. This
-- mirrors the existing 0049 (add) → 0050 (use) split.
--
-- IF NOT EXISTS makes the migration safely re-runnable.

-- Federal slips & forms ------------------------------------------------------
alter type doc_type add value if not exists 't4a';      -- T4A: pension/other income
alter type doc_type add value if not exists 't4a_oas';  -- T4A(OAS): Old Age Security
alter type doc_type add value if not exists 't4a_p';    -- T4A(P): CPP/QPP benefits
alter type doc_type add value if not exists 't4e';      -- T4E: EI benefits
alter type doc_type add value if not exists 't4rsp';    -- T4RSP: RRSP income
alter type doc_type add value if not exists 't4rif';    -- T4RIF: RRIF income
alter type doc_type add value if not exists 'fhsa';     -- FHSA / CELIAPP (T4FHSA + receipt)
alter type doc_type add value if not exists 't5008';    -- T5008: securities transactions
alter type doc_type add value if not exists 't5013';    -- T5013: partnership income
alter type doc_type add value if not exists 'nr4';      -- NR4: amounts paid to non-residents
alter type doc_type add value if not exists 't2200';    -- T2200: conditions of employment
alter type doc_type add value if not exists 't2091';    -- T2091: principal residence designation
alter type doc_type add value if not exists 't2201';    -- T2201: Disability Tax Credit certificate

-- Quebec slips (Relevés) -----------------------------------------------------
alter type doc_type add value if not exists 'rl2';      -- RL-2: retirement & annuity income
alter type doc_type add value if not exists 'rl5';      -- RL-5: benefits & indemnities
alter type doc_type add value if not exists 'rl6';      -- RL-6: QPIP
alter type doc_type add value if not exists 'rl7';      -- RL-7: investment plan (CIP)
alter type doc_type add value if not exists 'rl8';      -- RL-8: post-secondary studies (tuition)
alter type doc_type add value if not exists 'rl10';     -- RL-10: labour-sponsored fund credit
alter type doc_type add value if not exists 'rl15';     -- RL-15: partnership allocations
alter type doc_type add value if not exists 'rl18';     -- RL-18: securities transactions
alter type doc_type add value if not exists 'rl19';     -- RL-19: advance payments of credits
alter type doc_type add value if not exists 'rl24';     -- RL-24: childcare expenses
alter type doc_type add value if not exists 'rl25';     -- RL-25: profit-sharing plan income
alter type doc_type add value if not exists 'rl26';     -- RL-26: CRCD
alter type doc_type add value if not exists 'rl27';     -- RL-27: government payments
alter type doc_type add value if not exists 'rl31';     -- RL-31: leased dwelling (solidarity credit)
alter type doc_type add value if not exists 'rl32';     -- RL-32: First Home Savings Account (Quebec)
