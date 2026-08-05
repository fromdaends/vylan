-- THE ENGAGEMENT LETTER BELONGS TO A SERVICE, NOT TO THE FIRM.
--
-- Founder's correction, and it is how accounting firms actually work:
-- "accountants have a specific engagement letter that they send per service...
-- a universal engagement letter for a specific template service."
--
-- 1580 modelled ONE letter per firm per language. That is wrong: the letter is
-- the scope agreement for a particular piece of work, so a firm has one for
-- monthly bookkeeping, another for a T1, another for a review engagement. A
-- single firm-wide letter would send bookkeeping terms to a tax client.
--
-- ── WHAT THIS FIXES DOWNSTREAM ─────────────────────────────────────────────
--
-- The spec's duplicate guard says "the same SERVICE and year". Until now
-- "service" had to be approximated with engagements.type, which is four fixed
-- values and reads 'custom' on most real rows. With the letter hanging off
-- firm_services (1480), the guard can ask the question literally.
--
-- ── SAFE TO RE-KEY ─────────────────────────────────────────────────────────
--
-- engagement_letters was verified EMPTY on production before this was written
-- (1580 shipped hours ago and no letter had been uploaded), so no file loses
-- its home. service_id is nevertheless left NULLABLE rather than backfilled or
-- deleted: a row with no service simply never matches a lookup — inert — and
-- this migration destroys nothing on any environment where somebody was
-- quicker than expected.
--
-- Idempotent throughout. Safe to run twice.

alter table public.engagement_letters
  add column if not exists service_id uuid
    references public.firm_services(id) on delete cascade;

-- The old key (one letter per firm per language) has to go, or a firm could
-- never hold letters for two services at once.
alter table public.engagement_letters
  drop constraint if exists engagement_letters_firm_id_locale_key;

-- The new key. A partial unique index rather than a table constraint so any
-- pre-existing service-less row (see above) cannot collide with another.
create unique index if not exists engagement_letters_service_locale_key
  on public.engagement_letters (service_id, locale)
  where service_id is not null;

create index if not exists engagement_letters_service_idx
  on public.engagement_letters (service_id);

comment on column public.engagement_letters.service_id is
  'The service this letter is the agreement FOR (1480). The automated send reads it through at send time — deliberately, unlike a line''s price: the letter has not been agreed to yet, and once sent a COPY is frozen onto the engagement. Null = an orphan row from the firm-wide 1580 shape; never matched.';

comment on table public.engagement_letters is
  'The engagement letter for one SERVICE, one PDF per language, sent for signature by the send_engagement_letter workflow action. Set up on the service; the signed copies live on their own engagements.';

-- Verify after applying:
--
--   select count(*) from engagement_letters where service_id is null;  --> 0
--   -- and that two services can now each hold their own letter:
--   select service_id, locale, count(*) from engagement_letters
--     group by 1, 2 having count(*) > 1;                               --> no rows
