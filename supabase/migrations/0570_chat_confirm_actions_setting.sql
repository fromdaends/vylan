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
-- Owner-only firm policy: the UPDATE grant is column-scoped to authenticated
-- and the /api/firm route rejects non-owners; the model has no path to change
-- it. Additive + reversible (down: drop column). Gated: readers default a
-- missing column to TRUE (confirmation ON) so this ships before the SQL is
-- applied, with zero behavior change until then.

alter table firms
  add column if not exists chat_confirm_actions boolean not null default true;

-- Column-level UPDATE grant (firms locks updates per-column since 0039).
grant update (chat_confirm_actions) on public.firms to authenticated;
