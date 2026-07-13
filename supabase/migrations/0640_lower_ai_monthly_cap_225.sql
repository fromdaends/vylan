-- Lower the monthly AI-check (document analysis) cap 350 -> 225 (founder cost
-- control). Mirrors 0310 (which lowered 400 -> 350).
--
-- Two parts, so both new AND existing firms move to 225:
--   1. Change the firms.ai_monthly_cap column DEFAULT to 225, so every new firm
--      starts at the tighter ceiling.
--   2. Drop EXISTING firms that are still on the old 350 default down to 225.
--      Firms with a bespoke cap (any value other than 350) are left as-is.
--
-- Additive + reversible: to undo, set the default back to 350 and bump the 225s
-- back to 350.

alter table firms
  alter column ai_monthly_cap set default 225;

update firms
  set ai_monthly_cap = 225
  where ai_monthly_cap = 350;

comment on column firms.ai_monthly_cap is
  'Max client-document AI checks per calendar month (UTC) before the AI pipeline auto-pauses for the rest of the month. Default 225 (lowered from 350 in 0640). Service-role-only (excluded from the authenticated UPDATE whitelist).';
