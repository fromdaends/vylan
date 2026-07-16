-- Engagement workflow stage (feature: stages).
--
-- A THIRD axis on an engagement, orthogonal to the two that already exist:
--   * status  (draft/sent/in_progress/complete/cancelled) — the lifecycle.
--   * archived_at / deleted_at (migration 0139)           — the shelf.
--   * stage   (this migration)                            — WHERE in the workflow.
-- Nothing here changes the first two. Stages live INSIDE an active engagement
-- and answer "what is happening right now", replacing the generic "In progress"
-- badge with real workflow position.
--
-- stage is NULLABLE on purpose: a draft has no workflow position (it hasn't been
-- sent), and neither does a cancelled one. NULL = "no stage" and every reader
-- falls back to the existing status pill. The app NEVER computes a stage from
-- this column — src/lib/engagements/stage.ts resolves it from the engagement's
-- real contents (items / signatures / invoice / final documents) and
-- stage-sync.ts writes the result here. This column is a cache of that answer,
-- kept fresh by the event handlers, so a stale value self-heals on the next
-- event rather than being authoritative.
--
-- stage_history is an append-only audit log for future analytics (out of scope
-- for this feature): [{ stage, at, triggered_by }] where triggered_by is the
-- literal 'auto' or a user id (a manual override). Capped app-side.
--
-- Additive + reversible (down: drop the columns, then the type). Gated: every
-- reader/writer treats a missing column as "no stage" and falls back to the
-- status pill, so the app behaves exactly as today until this SQL is applied.

create type engagement_stage as enum (
  'collecting',
  'in_review',
  'in_preparation',
  'awaiting_signature',
  'awaiting_payment',
  'completed'
);

alter table engagements
  add column if not exists stage engagement_stage;
alter table engagements
  add column if not exists stage_updated_at timestamptz;
alter table engagements
  add column if not exists stage_history jsonb not null default '[]'::jsonb;

-- "Start preparation" is the one transition with no other trace in the data —
-- every other stage is derivable from what the engagement CONTAINS. This latch
-- records that the firm declared it was preparing. Everything else the resolver
-- treats as preparation (all documents approved, a signature out, a deliverable
-- uploaded) stays derived, so this is only consulted as one more OR arm.
alter table engagements
  add column if not exists preparation_started_at timestamptz;

-- The stage chip is rendered in list views that already filter by firm + scope;
-- this index serves the "active engagements at stage X" reads those do.
create index if not exists engagements_stage_idx
  on engagements (firm_id, stage)
  where stage is not null;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Infer a stage for every existing sent / in_progress / complete engagement by
-- mirroring the resolver's cascade (furthest-along wins). Drafts and cancelled
-- engagements are skipped — they have no workflow position and stay NULL.
--
-- This is deliberately an APPROXIMATION of resolveStage(): SQL can't cheaply
-- reproduce the AI-bounce nuance or the full deliverables-lock rule. It doesn't
-- need to — the first real event on an engagement re-syncs its stage from the
-- true facts, so any imprecision here self-heals. The goal is a sensible
-- starting position, not a proof.
with facts as (
  select
    e.id,
    e.status,
    -- Checklist (collection items only — signature items are their own axis).
    (
      select count(*) from request_items i
      where i.engagement_id = e.id and i.kind = 'collection'
    ) as items_total,
    (
      select count(*) from request_items i
      where i.engagement_id = e.id and i.kind = 'collection' and i.required
    ) as required_total,
    (
      select count(*) from request_items i
      where i.engagement_id = e.id and i.kind = 'collection' and i.required
        and i.status in ('approved', 'na')
    ) as required_done,
    -- Blocked = the client still owes something usable. An item that is
    -- 'pending' WITH a rejection_reason was AI-bounced (a file exists, the
    -- accountant can override) and is NOT blocked — same rule as
    -- computeAttention's itemsRequiredBlocked.
    (
      select count(*) from request_items i
      where i.engagement_id = e.id and i.kind = 'collection' and i.required
        and (
          (i.status = 'pending' and i.rejection_reason is null)
          or i.status = 'rejected'
        )
    ) as blocked,
    -- Signing: outstanding = out with the client. 'error' (setup failed),
    -- 'declined' / 'canceled' / 'expired' are the FIRM's problem, not a wait
    -- on the client, so they don't hold the engagement at awaiting_signature.
    exists (
      select 1 from signature_requests s
      where s.engagement_id = e.id
        and s.status in ('pending', 'sent', 'viewed')
    ) as has_pending_sig,
    exists (
      select 1 from signature_requests s where s.engagement_id = e.id
    ) as has_any_sig,
    -- Invoice still owed (0610 allows at most one non-cancelled row).
    exists (
      select 1 from payment_requests p
      where p.engagement_id = e.id and p.status in ('requested', 'failed')
    ) as has_unpaid_invoice,
    -- A deliverable exists. Invoice attachments live under /invoices/ in the
    -- same table and are NOT deliverables (mirrors
    -- listFinalDocumentsForEngagement).
    exists (
      select 1 from final_documents f
      where f.engagement_id = e.id
        and position('/invoices/' in f.storage_path) = 0
    ) as has_final_doc
  from engagements e
  where e.stage is null
    and e.status in ('sent', 'in_progress', 'complete')
),
resolved as (
  select
    f.id,
    (
      case
        -- Preparation reached: the firm has visibly moved past collection.
        -- Reused by the two arms below, so it's spelled out in each (SQL has no
        -- local binding inside a CASE).
        --
        -- 1. Completed. A lifecycle-complete engagement stands in for "final
        --    documents released" here: most existing completed engagements
        --    predate the final-documents feature entirely, so requiring a
        --    deliverable would wrongly park them all at in_preparation.
        when f.status = 'complete'
          and not f.has_unpaid_invoice
          and not f.has_pending_sig
          then 'completed'
        -- 2. Awaiting payment: invoice owed, signing done or never needed.
        when f.has_unpaid_invoice
          and not f.has_pending_sig
          and (
            f.status = 'complete' or f.has_final_doc or f.has_any_sig
            or (f.required_total > 0 and f.required_done = f.required_total)
          )
          then 'awaiting_payment'
        -- 3. Awaiting signature.
        when f.has_pending_sig then 'awaiting_signature'
        -- 4. In preparation.
        when f.status = 'complete' or f.has_final_doc or f.has_any_sig
          or (f.required_total > 0 and f.required_done = f.required_total)
          then 'in_preparation'
        -- 5. In review: everything the client owed is in, nothing blocked.
        when f.items_total > 0 and f.blocked = 0 then 'in_review'
        -- 6. Fallback.
        else 'collecting'
      end
    )::engagement_stage as stage
  from facts f
)
update engagements e
set
  stage = r.stage,
  stage_updated_at = now(),
  -- Seed the audit log with the inferred position so the stepper's "date
  -- entered" tooltip has something honest to show for pre-existing work. The
  -- timestamp is the backfill's, not a real transition — these engagements
  -- have no recorded stage history before now.
  stage_history = jsonb_build_array(
    jsonb_build_object(
      'stage', r.stage::text,
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'triggered_by', 'auto'
    )
  )
from resolved r
where e.id = r.id;
