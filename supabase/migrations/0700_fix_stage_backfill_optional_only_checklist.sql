-- Corrects a bug in migration 0690's backfill for engagements whose checklist
-- has NO required items (every item is optional — a Custom template, or one
-- edited after creation). 0690's `required_done` / `blocked` counts only
-- looked at required items, so an all-optional checklist always computed
-- blocked = 0 and required_done = 0, regardless of what the client actually
-- sent — which could misfire as "In review" (or, in principle, "In
-- preparation" / "Awaiting payment") even while a document was still pending
-- or rejected.
--
-- This is the SAME "fall back to counting all collection items when none are
-- required" rule the live app's own stage resolver already applies
-- (src/lib/engagements/stage.ts checklistFacts, and computeAttention before
-- it) — 0690's backfill just didn't implement it. That companion migration is
-- corrected too, so a FRESH environment backfills correctly from scratch;
-- this migration repairs rows a buggy 0690 already touched in an
-- already-migrated database.
--
-- Scope, deliberately narrow: only engagements whose stage_history is STILL
-- exactly the single 'auto' entry 0690's backfill seeded — i.e. nothing has
-- happened to the row since (no real event, no manual override). Touching
-- only untouched rows means this can never clobber a real transition or a
-- deliberate override that occurred after the original backfill.
--
-- Idempotent: re-running is a no-op once every affected row is corrected,
-- because the WHERE clause only matches rows whose computed stage still
-- differs from what's stored.

with facts as (
  select
    e.id,
    e.status,
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
      where i.engagement_id = e.id and i.kind = 'collection'
        and (i.required or not exists (
          select 1 from request_items i2
          where i2.engagement_id = e.id and i2.kind = 'collection' and i2.required
        ))
        and i.status in ('approved', 'na')
    ) as required_done,
    (
      select count(*) from request_items i
      where i.engagement_id = e.id and i.kind = 'collection'
        and (i.required or not exists (
          select 1 from request_items i2
          where i2.engagement_id = e.id and i2.kind = 'collection' and i2.required
        ))
        and (
          (i.status = 'pending' and i.rejection_reason is null)
          or i.status = 'rejected'
        )
    ) as blocked,
    exists (
      select 1 from signature_requests s
      where s.engagement_id = e.id
        and s.status in ('pending', 'sent', 'viewed')
    ) as has_pending_sig,
    exists (
      select 1 from signature_requests s where s.engagement_id = e.id
    ) as has_any_sig,
    exists (
      select 1 from payment_requests p
      where p.engagement_id = e.id and p.status in ('requested', 'failed')
    ) as has_unpaid_invoice,
    exists (
      select 1 from final_documents f
      where f.engagement_id = e.id
        and position('/invoices/' in f.storage_path) = 0
    ) as has_final_doc
  from engagements e
  where e.status in ('sent', 'in_progress', 'complete')
    and e.stage is not null
    -- Untouched since 0690's original backfill (defence in depth — see above).
    and jsonb_array_length(e.stage_history) = 1
    and (e.stage_history -> 0 ->> 'triggered_by') = 'auto'
),
resolved as (
  select
    f.id,
    (
      case
        when f.status = 'complete'
          and not f.has_unpaid_invoice
          and not f.has_pending_sig
          then 'completed'
        when f.has_unpaid_invoice
          and not f.has_pending_sig
          and (
            f.status = 'complete' or f.has_final_doc or f.has_any_sig
            or (f.required_total > 0 and f.required_done = f.required_total)
            or (f.required_total = 0 and f.items_total > 0 and f.required_done = f.items_total)
          )
          then 'awaiting_payment'
        when f.has_pending_sig then 'awaiting_signature'
        when f.status = 'complete' or f.has_final_doc or f.has_any_sig
          or (f.required_total > 0 and f.required_done = f.required_total)
          or (f.required_total = 0 and f.items_total > 0 and f.required_done = f.items_total)
          then 'in_preparation'
        when f.items_total > 0 and f.blocked = 0 then 'in_review'
        else 'collecting'
      end
    )::engagement_stage as corrected_stage
  from facts f
)
update engagements e
set
  stage = r.corrected_stage,
  stage_updated_at = now(),
  -- Replace, don't append: the original single entry was a WRONG computation,
  -- not a real transition the engagement passed through. Rewriting it keeps
  -- the audit trail honest — there's no "moved from in_review to collecting"
  -- event to record, only a corrected reading of where it always was.
  stage_history = jsonb_build_array(
    jsonb_build_object(
      'stage', r.corrected_stage::text,
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'triggered_by', 'auto'
    )
  )
from resolved r
where e.id = r.id
  and e.stage is distinct from r.corrected_stage;
