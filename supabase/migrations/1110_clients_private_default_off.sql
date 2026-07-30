-- 1110_clients_private_default_off.sql
--
-- Reverse 0840: a NEW firm no longer starts with every client private.
--
-- 0830 added firms.clients_private_by_default (default FALSE). 0840 flipped that
-- default to TRUE so privacy-first was the out-of-the-box posture for every new
-- account. The founder has reversed that call after living with it:
--
--   "make the all my clients and engagements are private by default off. Leave
--    the switch there though just in case."
--
-- WHY IT WAS WRONG IN PRACTICE. Privacy-first sounds like the safe default and
-- is the opposite. The owner sets a firm up, adds clients, invites their first
-- teammate — and that teammate opens an app with nothing in it. Every list empty,
-- no error, no explanation, because RLS is doing exactly what it was told. It
-- reads as a broken product on day one, which is the single worst day for it to.
-- That is precisely how this surfaced: the founder signed in as a staff account,
-- found "All engagements" empty, and reasonably reported it as a bug.
--
-- It is also the wrong SHAPE for the problem, which is the deeper reason. This
-- model hides everything and asks the owner to un-hide each client, forever, one
-- row at a time. The products this competes with do the reverse: Karbon starts
-- everything visible and restricts the PERSON once — a Restricted User sees only
-- the clients and work they are on the team for. The work lands on the person,
-- once, instead of on every client row for the life of the firm. Vylan is headed
-- to that model (membership-based visibility). Until it arrives, defaulting to
-- hidden buys very little and costs every new firm its first impression.
--
-- SCOPE — read this before assuming this migration fixed anything visible.
--
-- This changes ONLY the default for future INSERTs into firms. It deliberately
-- does NOT touch:
--   * any existing firms row (no cross-tenant flip — nobody's visibility changes
--     under them on apply), or
--   * any clients.is_private / engagements.is_private row.
--
-- So an EXISTING firm that already has the switch on stays exactly as it is. The
-- owner turns it off in Settings > Team, and THAT is what un-privates their
-- existing rows: setClientsPrivateDefault() runs the symmetric backfill. Setting
-- this column by hand in SQL would flip the flag and un-hide nothing, which is
-- the trap worth naming — the backfill lives in the server action, not here.
--
-- The switch itself stays. It is still the right control for a firm that wants
-- privacy-first; it is just no longer what a firm gets without asking.
--
-- Idempotent: setting a column default is a no-op when it already matches.

alter table public.firms
  alter column clients_private_by_default set default false;

comment on column public.firms.clients_private_by_default is
  'When true, NEW clients + engagements are created private, and flipping the switch backfills the firm''s existing rows in BOTH directions (see setClientsPrivateDefault). Default FALSE as of 1110 — 0840 had made it TRUE for new firms, which left every new firm''s first teammate staring at an empty app. Owners can still turn it on from Settings > Team.';
