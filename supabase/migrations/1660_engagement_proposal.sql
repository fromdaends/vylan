-- THE PROPOSAL SNAPSHOT — the document the client actually agreed to.
--
-- Split from 1650 rather than added to it: 1650 had already been applied, and
-- editing an applied migration file is a NO-OP — Supabase keys the ledger on
-- the version, sees 1650 recorded, and skips the file entirely. The change
-- silently does not happen. A new number is the only way to add a column after
-- the fact.
--
-- ── WHY THE ENGAGEMENT NEEDS THIS AT ALL ───────────────────────────────────
--
-- An engagement does not store its terms. The TEMPLATE does (1500's payload);
-- the engagement copies only the title, the intro message and the priced lines.
-- So there was literally nothing for a client to read and agree to.
--
-- ── WHY A SNAPSHOT AND NOT LIVE FIELDS ─────────────────────────────────────
--
-- Because a client who signed in February must still be holding what they
-- signed after the firm edits its standard terms in March. Live fields cannot
-- promise that; a frozen copy can. This is the repo's copy-on-use rule applied
-- to the one place it matters most — and it answers a question the competitor
-- research could NOT: not one of the four products documents whether terms
-- freeze at signing. Vylan's answer is yes, deliberately.
--
-- jsonb because the proposal is still growing (packages, per-service terms) and
-- because it is read AS A WHOLE by one component (proposal-preview.tsx), never
-- queried field by field. Same shape and the same rule as 1500: the READER
-- treats every field as optional and never throws.

alter table if exists public.engagements
  add column if not exists proposal jsonb;

comment on column public.engagements.proposal is
  'The client-facing document, FROZEN when it was sent. A snapshot, not live fields: a client who signed in February keeps holding what they signed even after the firm edits its standard terms in March. Read as a whole by proposal-preview.tsx; every field optional.';
