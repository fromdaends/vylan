-- ACCEPTANCE — the step between "we sent it" and "we are doing it".
--
-- Vylan could not mark an engagement accepted. `resolveAgreementStatus` has
-- modelled `accepted` since the status remodel, and NOTHING could reach it: the
-- only `accepted_at` anywhere in the codebase belongs to TEAM INVITES. Sending
-- an engagement emailed the client a document request immediately, so the
-- agreement — the thing an engagement letter exists to record — was skipped.
--
-- The founder found the same hole from the other side: "you send out the
-- proposal. They agree, sign, then you create the engagement with them, which
-- then prompts them to upload the documents."
--
-- ── THREE COLUMNS, THREE DIFFERENT FACTS ───────────────────────────────────
--
-- accepted_at   — WHEN they agreed.
-- accepted_by   — HOW. 'client' means they signed it themselves; 'firm' means
--                 somebody here recorded an agreement reached elsewhere (on the
--                 phone, on paper). These must never collapse into one another:
--                 a firm-recorded acceptance is NOT a signature, and if a
--                 dispute ever turns on it, "the client signed" and "we ticked a
--                 box saying they agreed" are different claims. Karbon draws the
--                 same line with "Accept on behalf".
-- activated_at  — WHEN THE WORK WAS ALLOWED TO START, which is a separate human
--                 decision. Karbon: Accepted -> Activate, "signalling that work
--                 can begin". A signature is the client's act; starting is the
--                 firm's. Conflating them means a January-signed engagement
--                 looks in-progress in January.
--
-- ── NULL IS THE HONEST DEFAULT ─────────────────────────────────────────────
--
-- Every existing engagement gets NULL, which reads as un-accepted. The other
-- direction would silently record that every historical client agreed to
-- something they were never asked. The resolver already treats a null
-- accepted_at as "predates acceptance" for exactly this reason.

alter table if exists public.engagements
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by text
    check (accepted_by is null or accepted_by in ('client', 'firm')),
  add column if not exists activated_at timestamptz;

-- The engagements list filters on "waiting for the client", which is
-- sent-and-not-yet-accepted. Partial so it stays small.
create index if not exists engagements_awaiting_acceptance_idx
  on public.engagements (firm_id)
  where accepted_at is null;

comment on column public.engagements.accepted_at is
  'When the client agreed. NULL = not yet, or the engagement predates acceptance — never assume agreement.';
comment on column public.engagements.accepted_by is
  '''client'' = they signed it themselves. ''firm'' = somebody here recorded an agreement reached elsewhere (Karbon''s "Accept on behalf"). NOT interchangeable: one is a signature, the other is a note that one was given.';
comment on column public.engagements.activated_at is
  'When the work was allowed to begin — a separate decision from acceptance. Signing is the client''s act; starting is the firm''s.';
