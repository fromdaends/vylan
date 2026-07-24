-- 0840_clients_private_default_on.sql
--
-- Team Wave 4 — make "clients private by default" the UNIVERSAL default.
--
-- 0830 added firms.clients_private_by_default with default FALSE (opt-in). The
-- founder's decision: privacy-first should be the out-of-the-box posture for
-- EVERY firm/account, not something each owner turns on. So flip the column
-- default to TRUE — every NEW firm created from now on starts with clients
-- private by default (owners can still turn it OFF from Team > Firm settings).
--
-- This changes only the DEFAULT for future INSERTs. Existing firm rows keep
-- whatever value they already have (no cross-tenant backfill here — an owner
-- who wants their existing clients private flips the switch, which backfills
-- their own firm). So no other tenant's current visibility changes on apply.

alter table public.firms
  alter column clients_private_by_default set default true;
