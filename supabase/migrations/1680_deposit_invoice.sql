-- The deposit becomes a REAL invoice, raised when the client accepts.
--
-- ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
--
-- The proposal could promise "$1,000 due upon acceptance" and nothing ever
-- charged it. The deposit lived only in the frozen proposal jsonb — no column,
-- no invoice, not deducted from anything. A client could accept and never be
-- asked for the money the document said was due.
--
-- ── THE INVARIANT THIS CHANGES, AND WHY ────────────────────────────────────
--
-- 0610 added `payment_requests_engagement_active_uniq`: ONE non-cancelled
-- invoice per engagement. That was right when an engagement billed once, at the
-- end. A deposit is a SECOND charge on the same engagement — paid up front,
-- with the balance still invoiced on completion — so the rule becomes one per
-- engagement PER KIND.
--
-- `kind` defaults to 'engagement', so every existing row keeps today's meaning
-- and the rebuilt index enforces exactly what the old one did for them.
--
-- ── APPLY-TIME NOTE ────────────────────────────────────────────────────────
--
-- The unique index below is rebuilt, not added. It cannot fail on existing data
-- (the old index already guaranteed uniqueness on the narrower key, and every
-- existing row shares one kind), but check anyway:
--
--   select engagement_id, kind, count(*) from payment_requests
--   where engagement_id is not null and status <> 'canceled'
--   group by engagement_id, kind having count(*) > 1;
--
-- Must return no rows.

-- What the client owes to make it live. Integer cents, like every other money
-- column. NULL = no deposit, which is not the same as 0.
alter table public.engagements
  add column if not exists deposit_cents integer;

comment on column public.engagements.deposit_cents is
  'Canopy''s "due upon acceptance". Invoiced when the proposal is accepted, '
  'separately from the engagement invoice raised at completion.';

-- Which charge this is. 'engagement' is the one everything meant before.
alter table public.payment_requests
  add column if not exists kind text not null default 'engagement';

comment on column public.payment_requests.kind is
  'engagement = the job''s invoice (0610 behaviour). deposit = the amount due '
  'when the client accepted the proposal.';

-- One live invoice per engagement PER KIND, replacing the one-per-engagement
-- rule from 0610. Created first, dropped second, so there is no window in which
-- neither is enforcing anything.
create unique index if not exists payment_requests_engagement_kind_uniq
  on public.payment_requests (engagement_id, kind)
  where status <> 'canceled';

drop index if exists public.payment_requests_engagement_active_uniq;
