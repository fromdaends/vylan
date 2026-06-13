-- Set-aware analysis, Phase 2 piece 2: a firm setting governing what happens
-- when the set assessment finds a multi-page document is missing a specific
-- page. SEPARATE from auto_reject_unusable_docs (0029) and auto_reject_duplicates
-- (0270) — three independent document policies.
--
--   OFF (default): a confidently-missing page is only flagged for the accountant.
--   ON:            the client is automatically asked, in plain French, to send
--                  the missing page, reusing the existing client-retry notify.
--
-- Uncertain placement (the set assessment's 'unplaceable' outcome) ALWAYS routes
-- to the accountant regardless of this flag — a guess is never sent to a client.
-- Additive + reversible (down: drop the column).
alter table firms
  add column if not exists auto_request_missing_pages boolean not null default false;

-- firms has a COLUMN-LEVEL update whitelist (0039_lock_down_column_updates):
-- authenticated members may only UPDATE listed columns. The owner-only Settings
-- toggle writes this column through the RLS-scoped session client, so it must be
-- granted. Grants are cumulative; the service-role AI worker bypasses this and
-- reads the column directly.
grant update (auto_request_missing_pages) on public.firms to authenticated;
