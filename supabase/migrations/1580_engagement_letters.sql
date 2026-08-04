-- THE FIRM'S ENGAGEMENT LETTER — the document `send_engagement_letter` sends.
--
-- Chunk 1 shipped that entry action recording an honest
-- `skipped (not_configured)`, because Vylan had nothing to send: every
-- signature in the product is a PDF the accountant uploads by hand, for one
-- engagement, placing the fields themselves. An automation cannot do either of
-- those things — nobody is there to pick a file or drag a box.
--
-- So the firm sets its letter up ONCE and every automation reuses it. That is
-- the same shape as firm_services (1480) and the automations library itself:
-- define once, drop onto any client.
--
-- ── WHY A TABLE AND NOT TWO COLUMNS ON firms ───────────────────────────────
--
-- Because there is one letter PER LANGUAGE. Half this client book is French,
-- the portal is bilingual, and a Quebec firm sending an English-only
-- engagement letter to a French client is exactly the kind of thing this
-- product exists to stop. A row per (firm, locale) says that plainly, and
-- leaves room for a later per-service dimension without another backfill.
--
-- ── NO FIELD PLACEMENT, BY DESIGN ──────────────────────────────────────────
--
-- The automated send uses SignWell's DEFAULT mode (with_signature_page: true),
-- which appends a clean signature page carrying the signer's field. That mode
-- exists precisely for documents nobody is standing over. The embedded editor
-- (place-anywhere) stays what it is: the manual path, for one-off documents.
--
-- Idempotent throughout. Safe to run twice.

create table if not exists public.engagement_letters (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,

  -- Which language's clients get this file.
  locale text not null check (locale in ('en', 'fr')),

  storage_path text not null,
  file_name text not null,

  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.users(id) on delete set null,

  -- One letter per language per firm. Replacing a letter overwrites this row
  -- rather than accumulating versions: the signed COPIES are what matter
  -- historically, and each of those is stored on its own engagement forever.
  unique (firm_id, locale)
);

create index if not exists engagement_letters_firm_idx
  on public.engagement_letters (firm_id);

alter table public.engagement_letters enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'engagement_letters'
      and policyname = 'engagement_letters_select'
  ) then
    create policy engagement_letters_select on public.engagement_letters
      for select using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  -- Writes are firm-scoped here; WHO in the firm may set the letter is the
  -- actions layer's decision (the firm.settings capability), the same split
  -- the service catalogue uses. A legal document is firm configuration.
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'engagement_letters'
      and policyname = 'engagement_letters_write'
  ) then
    create policy engagement_letters_write on public.engagement_letters
      for all using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      )
      with check (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;
end $$;

revoke all on public.engagement_letters from anon;
grant select, insert, update, delete on public.engagement_letters to authenticated;

comment on table public.engagement_letters is
  'The firm''s engagement letter, one PDF per language, sent for signature by the send_engagement_letter workflow action. Set up once and reused by every automation; the signed copies live on their own engagements.';

-- ── The duplicate guard's key ───────────────────────────────────────────────
--
-- The spec: "if a signed engagement letter already exists for this client
-- covering the same service and year, skip the send and audit-log the skip."
-- That question needs a key to ask it with, and it has to survive the fact
-- that engagements.type is a weak label (most real rows read 'custom').
--
-- So the key is written AT SEND TIME as `<type>:<year>` and compared against
-- the same client's other engagements. Null on every hand-made signature
-- request — this column only ever describes an automated engagement letter,
-- and a manual signature must never suppress an automated one.

alter table public.signature_requests
  add column if not exists letter_key text;

create index if not exists signature_requests_letter_key_idx
  on public.signature_requests (firm_id, letter_key)
  where letter_key is not null;

comment on column public.signature_requests.letter_key is
  'Set only on an AUTOMATED engagement letter: <engagement type>:<year> — what this letter covers. The send skips when the same client already has a completed letter with this key. Null on every manually-added signature.';

-- Verify after applying:
--
--   select count(*) from engagement_letters;                --> 0
--   select count(*) from signature_requests
--     where letter_key is not null;                         --> 0
