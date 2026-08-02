-- Bank reconciliation on the close board — the statement side of the check.
--
-- A bank reconciliation is one comparison: what the BOOKS say the account held
-- at month end, against what the BANK says it held. The books half we can read
-- from QuickBooks/Xero. The bank half exists only on a statement, and neither
-- ledger's API hands out a client's statement balance. So the firm types that
-- one number per account per month and the software does the comparing —
-- which is the whole point. A close feature that offers a checkbox saying
-- "bank rec done" has verified nothing; this one can be wrong out loud.
--
-- WHY A NUMBER AND NOT A TICK. If Vylan stored "reconciled: true" it would be
-- storing somebody's claim. Storing the statement balance means the difference
-- is recomputed from live book data every time the board is drawn: reconcile a
-- month, then post a late transaction into it, and the row goes back to "off by
-- $240.15" on its own. A tick would still say done.
--
-- CENTS, AS INTEGERS. Money never goes in a float. A balance can be negative
-- (credit cards, overdrawn accounts), so this is a signed bigint and there is
-- deliberately no non-negative constraint.
--
-- THE ACCOUNT ID IS THE LEDGER'S, AS TEXT. QuickBooks account ids are numeric
-- strings, Xero's are UUIDs; both are foreign identifiers we do not own, so
-- neither gets a uuid column or a foreign key. account_id is only ever
-- meaningful together with the client whose ledger it came from.
--
-- Migration number: 1210 was the highest on main; +10.

create table if not exists bank_statement_balances (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- The ledger's own account identifier (QuickBooks Id / Xero AccountID).
  account_id text not null check (char_length(account_id) between 1 and 128),
  -- First day of the month this statement closes, matching month_end_closes.
  period date not null check (period = date_trunc('month', period)::date),
  -- What the statement says the account held at period end, in cents. Signed.
  statement_balance_cents bigint not null,
  entered_at timestamptz not null default now(),
  entered_by uuid references auth.users(id) on delete set null
);

-- One statement balance per account per month. Also the upsert target: typing
-- a corrected figure overwrites rather than stacking a second opinion.
create unique index if not exists bank_statement_balances_account_period_idx
  on bank_statement_balances (client_id, account_id, period);

-- The board reads one firm's balances for one month.
create index if not exists bank_statement_balances_firm_period_idx
  on bank_statement_balances (firm_id, period);

alter table bank_statement_balances enable row level security;

-- Same shape as month_end_closes (1201): firm isolation plus the private-client
-- cascade — a private client's bank balances are exactly as restricted as the
-- knowledge that the client exists.
drop policy if exists bank_statement_balances_all on bank_statement_balances;
create policy bank_statement_balances_all on bank_statement_balances for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

revoke all on bank_statement_balances from anon, authenticated;
grant select, insert, update, delete on bank_statement_balances to authenticated;

comment on table bank_statement_balances is
  'What the bank statement said an account held at month end, in cents. The books side is read live from the ledger; the difference is computed, never stored.';

-- Verify after applying:
--   select client_id, account_id, period, statement_balance_cents
--     from bank_statement_balances order by period desc;
--
-- Expect zero rows until the first statement balance is entered.
