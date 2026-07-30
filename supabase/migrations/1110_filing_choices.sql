-- FILING CHOICES — two firm-level decisions that were previously hard-coded.
--
-- 1. WHETHER REJECTED DOCUMENTS ARE FILED.
--
--    They never are, and never have been: decideEligibility in
--    lib/filing/engine.ts refuses a rejected document outright with
--    reason 'rejected'. So this column does not FIX anything — it makes an
--    invisible guarantee visible and, for firms that want a complete archive
--    rather than a clean one, reversible.
--
--    Default false, which is exactly today's behaviour. A firm that changes
--    nothing sees no change.
--
-- 2. WHERE THE CLOUD FOLDER STRUCTURE COMES FROM.
--
--    'template' (today): the engine renders Clients/{client_name}/{year}/
--    {category} from the firm's token template.
--    'vylan': the engine mirrors the folders the firm actually built in Files
--    (migration 1100), so what they see in Vylan is what they get in Drive.
--
--    The founder's call was "let each firm choose", so this is a per-firm
--    switch rather than a product-wide decision. Default 'template', because
--    that is what every existing firm's storage already looks like and a
--    migration must never silently restructure someone's Drive.
--
-- Additive + reversible. Down:
--   alter table firm_filing_settings
--     drop column if exists file_rejected,
--     drop column if exists folder_source;

alter table firm_filing_settings
  -- Include documents the accountant rejected. OFF by default: a rejected
  -- document is one the firm told the client to replace, and filing it beside
  -- the good copy is how the wrong version ends up in someone's books.
  add column if not exists file_rejected boolean not null default false,
  -- 'template' = render the folder tokens (today). 'vylan' = mirror the
  -- firm's own folder tree from the Files section.
  add column if not exists folder_source text not null default 'template'
    check (folder_source in ('template', 'vylan'));
