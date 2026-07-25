-- Custom recurrence for repeating engagements: "every N months, on day D".
--
-- Extends the 0770 series model with a fourth frequency, 'custom', whose cycle
-- length is read from the new interval_months column instead of a fixed table
-- (monthly=1 / quarterly=3 / yearly=12). The day-of-month is the EXISTING
-- anchor_day column — for the three fixed frequencies it keeps being captured
-- as "the day repeat was switched on", and for 'custom' the accountant picks it
-- explicitly. Nothing about existing series changes.
--
-- Period keys for custom occurrences are 'YYYY-MM' (the spawn month), which is
-- unique per occurrence for any interval >= 1 month and already fits the
-- period_key length check. That keeps UNIQUE(series_id, period_key) — the
-- no-duplicate-spawn guarantee — working untouched.
--
-- Additive + reversible: every statement is idempotent, and the down direction
-- is "drop interval_months, restore the 3-value frequency check" (only possible
-- once no 'custom' rows remain, which is the correct safety behaviour).
--
-- GATED: code detects the missing column/constraint and treats custom as
-- unavailable, so this can deploy ahead of the SQL (repo's 0450+/0650 pattern).

-- 1. Allow the new frequency value. The 0770 inline CHECK is auto-named
--    recurring_series_frequency_check; drop-if-exists keeps this re-runnable.
alter table recurring_series
  drop constraint if exists recurring_series_frequency_check;
alter table recurring_series
  add constraint recurring_series_frequency_check
  check (frequency in ('monthly', 'quarterly', 'yearly', 'custom'));

-- 2. Cycle length in months for a custom series. NULL for the fixed
--    frequencies, which derive their cycle from the frequency itself.
--    Capped at 24 months (2 years) — beyond that a series is better expressed
--    as a one-off engagement.
alter table recurring_series
  add column if not exists interval_months int;

alter table recurring_series
  drop constraint if exists recurring_series_interval_months_check;
alter table recurring_series
  add constraint recurring_series_interval_months_check
  check (interval_months is null or interval_months between 1 and 24);

-- 3. THE invariant the application relies on: a custom series always carries
--    its interval. Enforced here rather than only in TypeScript, so no code
--    path (or manual edit) can create a custom series whose cycle length is
--    unknown — the scheduler would otherwise have to guess.
alter table recurring_series
  drop constraint if exists recurring_series_custom_interval_check;
alter table recurring_series
  add constraint recurring_series_custom_interval_check
  check (frequency <> 'custom' or interval_months is not null);
