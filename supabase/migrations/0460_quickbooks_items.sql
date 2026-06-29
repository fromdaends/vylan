-- QuickBooks Items cache — Stage 5, income groundwork.
--
-- Caches the connected company's products/services ("Items"), the 5th reference
-- list, so income posting (an Invoice line needs an ItemRef, NOT an account) can
-- offer a real item to pick. Mirrors the four cache tables from 0420 exactly
-- (one row per (firm, qbo_id), non-secret firm data: firm members SELECT their
-- own rows, all WRITES service-role-only via the sync job).
--
-- Items carry two extra columns beyond name/active:
--   item_type             — QBO Type (Service / NonInventory / Inventory / …);
--                           income posting prefers Service / NonInventory.
--   income_account_qbo_id — the item's income account, so a draft mapped to an
--                           income account can be matched to the item(s) that
--                           post to it.
--
-- Additive + reversible (down: drop the table). The app degrades gracefully
-- before this is applied: the four existing lists are read independently, so a
-- missing quickbooks_items table just means "no items yet", never an error.

create table if not exists quickbooks_items (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  qbo_id text not null,
  name text not null default '',
  item_type text,
  income_account_qbo_id text,
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique (firm_id, qbo_id)
);
create index if not exists quickbooks_items_firm_idx on quickbooks_items (firm_id);

-- RLS: firm members READ their own firm's items (non-secret); writes are
-- service-role-only (the sync job). Repo table-grant hardening (0190/0230/0420):
-- revoke the default grants, re-grant SELECT to authenticated only.
alter table quickbooks_items enable row level security;
drop policy if exists quickbooks_items_select on quickbooks_items;
create policy quickbooks_items_select on quickbooks_items for select
  using (firm_id = public.current_firm_id());
revoke all on quickbooks_items from anon, authenticated;
grant select on quickbooks_items to authenticated;
