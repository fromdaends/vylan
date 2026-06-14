-- Firm setting: include vs exclude Quebec tax forms (the RL / Relevé slips).
--
-- Quebec is the only province with its own slip system. A firm that works
-- entirely outside Quebec turns this OFF, and the Quebec-only RL slips (RL-1,
-- RL-3, ...) are hidden from every client checklist regardless of the client's
-- province. ON (default) = today's behaviour: the per-client province filter
-- still refines (a non-QC client of a Quebec firm drops the RL slips on its own).
--
-- Default TRUE so existing (Quebec-first) firms see no change. Additive +
-- reversible (down: drop the column).
alter table firms
  add column if not exists include_quebec_forms boolean not null default true;

-- firms has a COLUMN-LEVEL update whitelist (0039_lock_down_column_updates):
-- authenticated members may only UPDATE listed columns. The owner-only Settings
-- toggle writes this column through the RLS-scoped session client, so grant it.
grant update (include_quebec_forms) on public.firms to authenticated;
