-- Month-end close — one row per client per month, written when a firm declares
-- that month finished.
--
-- A tax firm has one busy season a year. A bookkeeping firm has twelve. If a
-- firm has thirty clients, that is thirty of these every single month, forever,
-- and keeping track of which are done, which are stuck, and what is blocking
-- them is most of what running the firm is. This table is the "done" half of
-- that: the only fact a close board cannot work out by looking at the ledger.
--
-- EVERYTHING ELSE IS DERIVED, ON PURPOSE. How many transactions are uncoded,
-- how many receipts are missing, how many requests the client has not answered
-- — all of that is read live from the books and the checklist when the board
-- asks. None of it is stored here, because a stored count is a count that can
-- be wrong, and a close board that quietly shows last week's numbers is worse
-- than no close board at all.
--
-- THE PERIOD IS A DATE, NOT A STRING. Stored as the FIRST DAY of the month
-- (2026-07-01 means July 2026). A date sorts, compares and ranges correctly for
-- free; '2026-07' sorts as text and breaks the first time anyone asks for "the
-- last three months". The application never puts anything but a month-start in
-- here, and the check constraint says so out loud.
--
-- ONE ROW MEANS CLOSED. There is no status column and no 'open' row: a month is
-- open until somebody closes it, and absence is the cleanest way to say that.
-- Reopening DELETES the row rather than flipping a flag, so a reopened month is
-- indistinguishable from one never closed — which is what "reopened" means.
-- (The audit log keeps the history of who closed and who reopened; that is the
-- right home for it, not a graveyard of superseded rows here.)

create table if not exists month_end_closes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- First day of the closed month.
  period date not null check (period = date_trunc('month', period)::date),
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  -- Whatever the person closing wants the next person to know. Optional.
  note text
);

-- A month is closed once or not at all. This is also the upsert target: closing
-- an already-closed month conflicts into a no-op rather than stacking rows.
create unique index if not exists month_end_closes_client_period_idx
  on month_end_closes (client_id, period);

-- The board reads one firm's closes for one month.
create index if not exists month_end_closes_firm_period_idx
  on month_end_closes (firm_id, period);

alter table month_end_closes enable row level security;

-- Same shape as organize_suggestions (1140): firm isolation plus the
-- private-client cascade — knowing whether a private client's month is closed
-- is exactly as restricted as knowing that client exists.
drop policy if exists month_end_closes_all on month_end_closes;
create policy month_end_closes_all on month_end_closes for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

revoke all on month_end_closes from anon, authenticated;
-- Closing and reopening are ordinary firm work, so authenticated users get the
-- write grants the policy above then scopes to their own firm.
grant select, insert, update, delete on month_end_closes to authenticated;

comment on table month_end_closes is
  'One row per client per month, written when the firm declares that month closed. Absence means open; reopening deletes the row.';

-- Verify after applying:
--   select client_id, period, closed_at from month_end_closes order by period desc;
--
-- Expect zero rows until the first month is closed.
