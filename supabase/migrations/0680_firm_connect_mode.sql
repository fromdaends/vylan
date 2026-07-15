-- Stripe Connect: record the MODE (test vs live) of a firm's connected account.
--
-- Context: this project's dev environment shares the SAME database as production
-- (remote Supabase, no local Docker). Dev runs a TEST Stripe key; prod runs a
-- LIVE key. Because both write the same firms.stripe_connect_* columns, a firm
-- connected in TEST mode looks "ready to accept payments" to the LIVE site — but
-- a live key can NEVER charge a test-mode connected account (Stripe hard-blocks
-- cross-mode access). The result is a client-facing "Pay now" that always fails.
--
-- This column stamps which Stripe mode a firm's connection belongs to, so the
-- app can (a) refuse to let a TEST-mode action mutate a LIVE-mode firm's
-- connection, and (b) only treat a firm as payment-ready when its connection
-- mode matches the environment's current key mode. Null = unknown (legacy rows
-- connected before this migration); those keep their prior behaviour until the
-- next Connect status write stamps them.
--
-- Additive + reversible (down: drop the column). No `grant update` — like the
-- other connect_* columns (see 0370 / 0039) this is service-role-write-only, so
-- an authenticated member can never PATCH it. SELECT stays table-wide.

alter table firms
  add column if not exists stripe_connect_mode text
    check (stripe_connect_mode in ('test', 'live'));
