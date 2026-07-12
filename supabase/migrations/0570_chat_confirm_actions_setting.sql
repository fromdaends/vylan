-- Firm-level "send confirmation cards" toggle for the engagement assistant
-- (Assistant panel, phase 3 follow-up).
--
-- When TRUE (the default, and the safe behavior): the assistant PROPOSES every
-- action and the accountant must press Confirm on a card before anything runs
-- — the phase-3 propose-and-confirm flow, unchanged.
--
-- When FALSE: a firm that trusts the assistant can skip the confirm step. The
-- server (never the model) reads this flag and, for a proposed action, executes
-- it immediately under the caller's own RLS session and shows a "Done" card
-- instead of a Confirm/Cancel one. The action is still written to
-- chat_pending_actions and logged to the activity timeline exactly as a
-- confirmed action, so there is a full audit trail either way.
--
-- Owner-only firm policy. This is a SECURITY control (it governs whether the
-- AI may act with no human in the loop), so unlike the other firm toggles it
-- is SERVICE-ROLE WRITE ONLY: there is deliberately NO authenticated UPDATE
-- grant (firms revoked blanket UPDATE in 0039, so an ungranted column simply
-- cannot be PATCHed via PostgREST). The /api/firm/chat-confirm-actions route
-- checks role === 'owner' and then writes through the service-role client, so
-- a non-owner member cannot flip it by hitting PostgREST directly (which the
-- firm's RLS UPDATE policy allows for any same-firm member, regardless of
-- role). Mirrors seat_cap_override / stripe_connect_* (0190 / 0370).
--
-- Additive + reversible (down: drop column). Gated: readers default a missing
-- column to TRUE (confirmation ON) so this ships before the SQL is applied,
-- with zero behavior change until then.

alter table firms
  add column if not exists chat_confirm_actions boolean not null default true;

-- No authenticated UPDATE grant on purpose: written only by the service role
-- inside the already owner-checked route (see the header comment above).
