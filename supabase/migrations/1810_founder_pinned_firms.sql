-- THE FOUNDERS' WATCHLIST — firms Zach and Tyler want to keep an eye on.
--
-- Founder: "make it so we can pin firms we'd like to track."
--
-- ── ONE SHARED LIST, NOT ONE PER PERSON ────────────────────────────────────
--
-- firm_id is the PRIMARY KEY, so a firm is pinned or it is not — there is no
-- "Zach's pins" and "Tyler's pins". That is the founder's word "we": there are
-- two of them running one company, and a watchlist that only half of them can
-- see is a watchlist that gets checked half as often. `pinned_by_user_id`
-- records WHO added it so the other one can ask why, which is the useful half
-- of per-person without splitting the list.
--
-- ── WHY THIS IS NOT A COLUMN ON `firms` ────────────────────────────────────
--
-- `firms` belongs to the customer. A flag there would be Vylan's private
-- opinion about a customer living inside that customer's own row — one
-- mis-scoped SELECT away from a firm reading that we have them on a watchlist.
-- A separate table that `authenticated` cannot touch at all makes that
-- impossible rather than unlikely.
--
-- ── RLS: SERVICE ROLE ONLY, NO POLICIES AT ALL ─────────────────────────────
--
-- Every other table in this schema grants `authenticated` something and leans
-- on a policy to scope it. This one grants NOTHING. RLS is on with zero
-- policies, which denies every authenticated and anon request outright, and the
-- only reader/writer is the founders console — which runs behind the
-- FOUNDER_EMAILS env allowlist and uses the service role.
--
-- That means the access rule for this table lives in ONE place (the env
-- allowlist), not two. A policy here would be a second, weaker copy of that
-- rule that could disagree with it.

create table if not exists public.founder_pinned_firms (
  -- One row per firm: pinned, or absent. PK rather than a surrogate id +
  -- unique, because "pinned twice" is not a state that should be expressible.
  firm_id uuid primary key references public.firms(id) on delete cascade,

  -- Who put it on the list. SET NULL rather than CASCADE: if the person who
  -- pinned it is ever removed, the firm should STAY on the watchlist — losing
  -- the reason to watch a firm because of an unrelated account change is how a
  -- list silently empties.
  pinned_by_user_id uuid references public.users(id) on delete set null,

  -- Why we are watching. Deliberately UNREAD by the current UI, exactly as
  -- user_rates.billable_rate_hourly (1750) is: the column costs nothing now and
  -- saves a migration when the console grows a "why" line, and a watchlist
  -- without room for a reason is a list of names nobody can act on later.
  note text,

  created_at timestamptz not null default now()
);

-- The one query the console runs: "which firms are pinned, newest first".
create index if not exists founder_pinned_firms_created_idx
  on public.founder_pinned_firms (created_at desc);

alter table public.founder_pinned_firms enable row level security;

-- No grants and no policies. Service role only — see the header.
revoke all on public.founder_pinned_firms from anon, authenticated;

comment on table public.founder_pinned_firms is
  'Vylan founders'' shared watchlist of customer firms. Read and written ONLY by '
  'the /founders console via the service role, behind the FOUNDER_EMAILS env '
  'allowlist. RLS is on with ZERO policies on purpose: authenticated and anon '
  'are denied outright, so the access rule lives in exactly one place.';
