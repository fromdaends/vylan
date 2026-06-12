-- Lower the monthly AI-check cap 400 -> 350 (founder cost control).
--
-- Two parts:
--   1. Change the firms.ai_monthly_cap column DEFAULT to 350, so every new firm
--      starts at the lower ceiling.
--   2. Drop EXISTING firms that are still on the old 400 default down to 350.
--      Firms with a custom cap (any value other than 400 — e.g. a deliberately
--      raised quota) are left untouched.
--
-- Additive + reversible: to undo, set the default back to 400 and bump the 350s
-- back to 400. No data is dropped; only this numeric ceiling moves.

------------------------------------------------------------------------------
-- 1. New-firm default.
------------------------------------------------------------------------------
alter table firms
  alter column ai_monthly_cap set default 350;

------------------------------------------------------------------------------
-- 2. Existing firms still on the old default. Bounded by `= 400` so any custom
--    per-firm cap survives.
------------------------------------------------------------------------------
update firms
  set ai_monthly_cap = 350
  where ai_monthly_cap = 400;

comment on column firms.ai_monthly_cap is
  'Max client-document AI checks per calendar month (UTC) before the AI pipeline auto-pauses for the rest of the month. Default 350 (lowered from 400 in 0310). Service-role-only (excluded from the authenticated UPDATE whitelist).';
