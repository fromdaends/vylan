-- The firm's own province — the fallback for sales tax on a service item.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- The founder asked for the tax on a service item to "fill automatically based
-- on the province you're in", and it shipped reading the CLIENT's province,
-- which is the correct basis: Canadian place-of-supply for services puts the
-- rate on the recipient, so a Montreal firm billing an Ontario client charges
-- 13% HST and not 14.975% GST+QST.
--
-- Correct, and almost never useful. 99 of the 103 clients on production have no
-- province on file, so the box stayed empty for 96% of them and the feature
-- looked like it had not shipped. The founder, immediately: "can't see the
-- change."
--
-- So the firm gets one too, as the FALLBACK — the province you're in, which is
-- what was asked for and what an accountant's clients mostly are. The client's
-- own province still wins whenever it is known; this only answers the case
-- where nobody has filled one in.
--
-- ── WHY IT IS NULLABLE AND HAS NO DEFAULT ──────────────────────────────────
--
-- A guessed province is a wrong tax rate on a real invoice. There is no
-- defensible value to seed: this firm's timezone is America/Toronto and its
-- clients include Quebec ones, which is exactly the ambiguity that makes
-- guessing unsafe. NULL means "nobody has said", the Tax % box stays empty, and
-- the accountant types the number the way they do today. Nothing regresses
-- while it is unset.

alter table public.firms
  add column if not exists province text;

-- The same 13 codes clients are constrained to. A typo here would silently
-- produce no rate rather than a wrong one, but a constraint says so at write
-- time instead of leaving somebody hunting for why the box is still empty.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'firms_province_check'
  ) then
    alter table public.firms
      add constraint firms_province_check
      check (
        province is null
        or province in (
          'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'
        )
      );
  end if;
end $$;

comment on column public.firms.province is
  'Firm''s province, used as the sales-tax fallback when a client has none on file. The client''s own province always wins. NULL = not set; the Tax % field stays empty rather than guessing.';
