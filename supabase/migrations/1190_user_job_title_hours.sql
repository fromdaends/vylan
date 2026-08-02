-- A teammate is a job title and a week's capacity, not just a name and a rank.
--
-- Phase 2 of the team plan: "turn a teammate from a name and an email into a
-- profile". Two columns, and the second one is the important one.
--
-- WHY HOURS MATTER NOW, A PHASE BEFORE ANYTHING READS THEM. The People table
-- says "9 engagements" today, and nine simple returns is not nine corporate
-- year-ends. A count with no denominator cannot answer the only question an
-- owner actually asks before handing out the next job: does this person have
-- room? Capacity is the hours someone has; load is the hours assigned to them.
-- The planner (phase 6) and time tracking (phase 8) both need this number, and
-- the roadmap's own rule applies — cheap now, expensive to retrofit through
-- every call site later.
--
-- NULLABLE, NO DEFAULT, both of them. There is no sensible default job title,
-- and a default of 40 hours would be a lie about every part-timer in the firm
-- that nobody would ever notice. Null means "not recorded", and every reader
-- must show it as unknown rather than assuming full time.
--
-- WEEKLY_HOURS IS NUMERIC, NOT INTEGER. Part-time contracts are 22.5 hours as
-- often as they are 20, and rounding somebody's week is how a capacity figure
-- stops being trusted.
--
-- RLS: users already carries its firm-scoped policy, so the new columns inherit
-- it. No policy change needed. Who may EDIT them is decided in the application
-- (team.manage, owner-only today) — the same place every other roster write is
-- gated, because all of them go through the service-role client.
--
-- Additive and reversible:
--   alter table users
--     drop column if exists weekly_hours,
--     drop column if exists job_title;

alter table users
  add column if not exists job_title text;

alter table users
  add column if not exists weekly_hours numeric(5, 2)
    check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 168));

comment on column users.job_title is
  'Free text, e.g. "Senior bookkeeper". Null when not recorded.';
comment on column users.weekly_hours is
  'Hours this person is available in a normal week. The denominator a workload count needs. Null when not recorded — readers must not assume full time.';

-- Verify after applying:
--   select id, name, job_title, weekly_hours from users order by name;
--
-- Expect both columns present and null for everyone until somebody fills them in.
