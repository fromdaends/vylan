-- THE CLIENT'S SIDE OF ACCEPTANCE.
--
-- 1640 gave the FIRM three verbs (accept on behalf, activate, revert). This is
-- the client's: they open a link, read the proposal, and accept or decline.
--
-- ── WHY A FLAG AND NOT JUST "accepted_at IS NULL" ──────────────────────────
--
-- The portal shows the proposal when the engagement is waiting to be accepted.
-- Deriving that from `accepted_at is null` alone would be a BREAKING CHANGE for
-- every engagement already in flight: their acceptance is null because the step
-- did not exist, not because anybody is waiting on a signature, and their
-- clients are mid-upload. They would all open their portal tomorrow and be
-- shown a proposal to sign for work already under way.
--
-- So it is explicit. `requires_acceptance` is FALSE by default: every existing
-- engagement keeps behaving exactly as it does today, and only work sent as a
-- proposal from now on asks the client to agree.
--
-- ── DECLINING ──────────────────────────────────────────────────────────────
--
-- None of the four products researched documents a declined state at all — it
-- is one of the gaps recorded in docs/canopy-parity.md. So this is Vylan's own
-- decision, made deliberately: a client who says no must be able to say so and
-- say why, because the alternative is a proposal that sits in "waiting" forever
-- while the firm wonders, and a client who has to phone up to refuse.
--
-- Declining is NOT terminal. `declined_at` clears when the firm reverts to
-- draft and sends a revised proposal, which is the whole point of being told
-- why.

alter table if exists public.engagements
  add column if not exists requires_acceptance boolean not null default false,
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text;

-- "Waiting on the client to accept" is a list the firm will want. Partial so it
-- stays small — most engagements are not waiting.
create index if not exists engagements_awaiting_client_idx
  on public.engagements (firm_id)
  where requires_acceptance = true and accepted_at is null and declined_at is null;

comment on column public.engagements.requires_acceptance is
  'Does this engagement need the client to agree before work starts? FALSE by default so every engagement that predates the proposal step keeps its current portal behaviour — deriving this from accepted_at IS NULL would show a signing page to clients already mid-upload.';
comment on column public.engagements.declined_at is
  'When the client said no. Not terminal: cleared when the firm reverts to draft and sends a revised proposal.';
comment on column public.engagements.decline_reason is
  'What the client said, in their words. Optional — a client who will not explain must still be able to decline.';
