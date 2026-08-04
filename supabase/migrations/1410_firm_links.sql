-- Quick links on the Overview (design 2a).
--
-- ⚠️ RENUMBERED 1390 → 1410, and the file is otherwise untouched.
--
-- It shipped in #1234 as 1390 while another session shipped 1390_task_priority
-- in #1235. Both merged; the priority one applied first and took the version
-- number in supabase_migrations. Supabase's ledger keys on the VERSION, so the
-- second file of a pair can never be recorded — this migration was unappliable
-- and would have stayed that way silently, exactly the failure #1137 spent a
-- session repairing across eight pairs.
--
-- Renumbered rather than deleted (deleting a migration is a hard no in
-- CLAUDE.md), and THIS one moved rather than the other because the other is
-- already applied and recorded: renaming an applied migration would only make
-- the ledger try to run it again under a new number.
--
-- Four lines of text with URLs — the tabs an accountant already keeps open all
-- day (CRA, Revenu Québec, Stripe, the firm's Drive), pinned to the left column
-- of the dashboard so they stop living in browser bookmarks nobody can share.
--
-- A TABLE, not a JSON column on firms: rows are the shape the feature is
-- (add one, remove one, reorder them), and a JSON blob would make every write
-- a read-modify-write race between two people editing links at once.
--
-- ── WHO CAN TOUCH THEM ──────────────────────────────────────────────────────
--
-- Everyone in the firm, read and write — the same call as engagement_tasks
-- (1340): a shared shelf only the owner may restock is a shelf that stays
-- stale. The links are firm-wide utilities, not settings.
--
-- ── SEEDING ─────────────────────────────────────────────────────────────────
--
-- Existing firms get the four defaults from the approved design, ONCE, and
-- only if they have no links at all — so re-running this file never duplicates
-- and never resurrects a link somebody deleted. Firms created after this
-- migration start empty and add their own; no trigger on the signup path,
-- because a failing seed trigger would be a failing signup.
--
-- Idempotent throughout. Safe to run twice.

create table if not exists firm_links (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  label text not null,
  url text not null,
  -- Display order, spaced by tens so a link can be moved between two others
  -- without renumbering the rest.
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);

-- The list is always read for one firm in display order.
create index if not exists firm_links_firm_idx on firm_links (firm_id, sort);

alter table firm_links enable row level security;

drop policy if exists firm_links_all on firm_links;
create policy firm_links_all on firm_links for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

revoke all on firm_links from anon;
grant select, insert, update, delete on firm_links to authenticated;

-- The four defaults from the approved design, for firms that exist today and
-- have never had a link. ONE statement so the "has no links" guard is decided
-- once per firm, not once per row.
insert into firm_links (firm_id, label, url, sort)
select f.id, seed.label, seed.url, seed.sort
from firms f
cross join (
  values
    ('CRA — My Business Account', 'https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/business-account.html', 0),
    ('Revenu Québec — Mon dossier', 'https://www.revenuquebec.ca/en/online-services/', 10),
    ('Stripe dashboard', 'https://dashboard.stripe.com', 20),
    ('Google Drive', 'https://drive.google.com', 30)
) as seed(label, url, sort)
where not exists (select 1 from firm_links fl where fl.firm_id = f.id);

comment on table firm_links is
  'Firm-level quick links shown on the Overview dashboard — label + URL rows any member can add or remove. Seeded once with the four defaults from the 2a design for firms that existed before it.';

-- Verify after applying:
--
--   select count(*) from firm_links;
--   --> 4 × (number of firms), assuming nobody had links before.
--
--   -- and re-run this whole file: the count must not change.
