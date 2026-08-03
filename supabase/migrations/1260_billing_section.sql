-- The firm-level Billing section: money actually received, and chasing the money
-- that wasn't.
--
-- Three things the invoice model could not express before this migration.
--
-- 1. A PAYMENT IS A THING THAT HAPPENED, NOT A FLAG ON THE INVOICE.
-- Until now "paid" was a status plus a Stripe/PayPal reference, which works
-- exactly as long as every payment is one online payment for the full amount.
-- Firms get paid by Interac, cheque and cash constantly, and a cheque for half
-- the bill is not an edge case. A single set of columns on payment_requests
-- (method, date, reference, who recorded it) would be overwritten by the second
-- partial payment and silently lose the first — so payments get their own
-- table, one row per payment actually received.
--
-- 2. amount_paid_cents IS DERIVED, AND A TRIGGER KEEPS IT THAT WAY.
-- The invoice list and the outstanding/overdue totals need "how much is still
-- owed" per row, which a per-draw sum over the ledger would make an N+1. So the
-- running total is denormalized onto payment_requests — but never written by
-- application code. The trigger below is its ONLY writer, so it cannot drift
-- from the ledger the way a hand-maintained counter eventually does.
--
-- ⚠ LEGACY ROWS HAVE amount_paid_cents = 0 AND ARE FULLY PAID. Every invoice
-- settled before this migration has status 'paid' and no ledger row, so the
-- outstanding amount is NEVER amount_cents - amount_paid_cents on its own.
-- It is: status = 'paid' → 0, else amount_cents - amount_paid_cents. That rule
-- lives in one place in the code (lib/invoices/outstanding.ts) and every reader
-- goes through it. Backfilling the old rows was considered and rejected: it
-- would invent a payment date, method and amount that nobody recorded.
--
-- 3. CHASING. Unpaid invoices ride the SAME job queue that chases missing
-- documents (jobs + /api/cron/process-jobs), so the columns here are only the
-- per-invoice state that queue needs: is chasing on, how many have gone, when
-- the last one went. There is no second scheduler and no new cron.
--
-- Migration number: written as 1240 off a highest-of-1230, then renumbered to
-- 1260 when a merge from main brought in BOTH 1240 and 1250 from two other
-- sessions. The duplicate check in CLAUDE.md caught it (`ls supabase/migrations
-- | sed 's/_.*//' | sort | uniq -d` printed 1240), which is exactly the failure
-- that once put eight pairs of files on the same version and broke the Supabase
-- check on every migration PR for months. Re-run that check after any merge,
-- not just before writing the file.

-- ── The payment ledger ──────────────────────────────────────────────────────

create table if not exists invoice_payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  payment_request_id uuid not null
    references payment_requests(id) on delete cascade,
  -- Copied from the invoice at insert. Denormalized ON PURPOSE: it lets the RLS
  -- policy below mirror payment_requests' private-client cascade exactly,
  -- without a join inside a policy (which would run per row).
  client_id uuid references clients(id) on delete set null,
  engagement_id uuid references engagements(id) on delete set null,
  -- Always positive. A refund is not a negative payment — refunds stay a Stripe
  -- dashboard operation in v1, and Void covers a mistaken invoice.
  amount_cents bigint not null check (amount_cents > 0),
  -- How the money arrived. 'stripe'/'paypal' rows are written by the rails at
  -- the paid flip; the rest are what a human recorded.
  method text not null check (
    method in ('stripe', 'paypal', 'interac', 'cheque', 'cash', 'other')
  ),
  -- The date the firm actually got the money, which is not always today —
  -- a cheque recorded on Monday may have been received on Friday.
  paid_on date not null,
  reference text check (char_length(reference) <= 300),
  -- Who recorded it. Null for the rails (no human) and for a deactivated user.
  recorded_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invoice_payments_request_idx
  on invoice_payments (payment_request_id, paid_on desc);
create index if not exists invoice_payments_firm_idx
  on invoice_payments (firm_id, paid_on desc);

alter table invoice_payments enable row level security;

-- Identical shape to payment_requests_all (0810): a payment against a private
-- client's invoice is exactly as restricted as the invoice itself. Anything
-- looser would leak the amount and timing of work a non-owner cannot see.
drop policy if exists invoice_payments_all on invoice_payments;
create policy invoice_payments_all on invoice_payments for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        (engagement_id is null or not public.engagement_is_private(engagement_id))
        and (client_id is null or not public.client_is_private(client_id))
      )
    )
  )
  with check (firm_id = public.current_firm_id());

revoke all on invoice_payments from anon, authenticated;
grant select, insert, update, delete on invoice_payments to authenticated;

comment on table invoice_payments is
  'One row per payment received against an invoice, whatever the method. The only writer of payment_requests.amount_paid_cents (via trigger).';

-- ── The derived total ───────────────────────────────────────────────────────

alter table payment_requests
  add column if not exists amount_paid_cents bigint not null default 0;

comment on column payment_requests.amount_paid_cents is
  'Sum of invoice_payments for this invoice, maintained by trigger. ZERO ON PRE-1260 PAID ROWS — outstanding is 0 when status = paid, regardless of this column.';

-- The ledger's single reflection. Recomputed as a full re-sum rather than an
-- increment: an increment is only correct if every event is seen exactly once,
-- and a re-sum is correct even if one is replayed or a correction is deleted.
create or replace function public.sync_invoice_amount_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.payment_request_id, old.payment_request_id);
begin
  update payment_requests
     set amount_paid_cents = coalesce(
       (select sum(amount_cents) from invoice_payments
         where payment_request_id = target), 0)
   where id = target;
  return null;
end;
$$;

drop trigger if exists invoice_payments_sync_total on invoice_payments;
create trigger invoice_payments_sync_total
  after insert or update or delete on invoice_payments
  for each row execute function public.sync_invoice_amount_paid();

-- ── Manual as a rail ────────────────────────────────────────────────────────
-- paid_provider (0730) answers "which rail collected the money" and was
-- constrained to the two online ones. A cheque did not arrive by a rail at all,
-- so it gets its own value; WHICH kind of manual payment it was lives on the
-- ledger row, not here, because one invoice can be settled by two of them.
alter table payment_requests
  drop constraint if exists payment_requests_paid_provider_check;
alter table payment_requests
  add constraint payment_requests_paid_provider_check
    check (paid_provider is null
           or paid_provider in ('stripe', 'paypal', 'manual'));

-- ── Chasing ─────────────────────────────────────────────────────────────────

alter table payment_requests
  -- Default ON: an invoice nobody chases is the problem this feature exists to
  -- solve. The firm-wide default below decides what NEW invoices get; this
  -- column is the per-invoice answer and always wins.
  add column if not exists auto_chase boolean not null default true,
  add column if not exists chase_count integer not null default 0,
  add column if not exists last_chased_at timestamptz;

comment on column payment_requests.auto_chase is
  'Per-invoice reminder switch. The worker re-reads this every time a chase job fires, so switching it off stops the cadence immediately without cancelling queued jobs.';

alter table firm_invoice_settings
  add column if not exists chase_enabled_default boolean not null default true,
  -- Bounds are enforced here as well as in the UI: a 0-day interval would queue
  -- a reminder a second, and 30 chases is harassment, not collection.
  add column if not exists chase_interval_days integer not null default 7
    check (chase_interval_days between 1 and 60),
  add column if not exists chase_max integer not null default 4
    check (chase_max between 1 and 12);

-- Verify after applying:
--   select count(*) from invoice_payments;                      -- expect 0
--   select amount_paid_cents, auto_chase, chase_count
--     from payment_requests limit 5;                            -- expect 0, true, 0
--   select chase_enabled_default, chase_interval_days, chase_max
--     from firm_invoice_settings;                               -- expect true, 7, 4
