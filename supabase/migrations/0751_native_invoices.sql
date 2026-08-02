-- Native invoice creation (Phases 1-3): firm invoice settings + real-invoice
-- columns on payment_requests + the per-firm sequential number allocator.
--
-- ONE migration for the whole build (fewer manual prod applies): everything is
-- additive and inert until the code that uses it ships. Phase 1 uses
-- firm_invoice_settings; Phase 2 uses the payment_requests columns + the
-- allocator; Phase 3 reads both to render the PDF / portal detail.
--
-- GATED: every reader/writer treats a missing table/column as "invoicing not
-- set up" (code-only error-code checks, the 0650 pattern), so the app behaves
-- exactly as today until this file is applied. Dev + previews point at the
-- prod DB, so that window is real.
--
-- Additive + reversible (down: drop function allocate_invoice_seq, drop table
-- firm_invoice_settings, drop the payment_requests columns + index).

-- ── 1. Firm invoice settings ────────────────────────────────────────────────
-- One row per firm, created lazily the first time the owner saves the
-- Invoicing settings. Identity (name / logo / brand color) deliberately stays
-- on firms — this table holds only what invoices ADD. A firm with no row here
-- has not set up invoicing: the invoice builder still works (no taxes, no
-- number formatting beyond the bare default) and automation behaves exactly
-- as before the feature.
create table if not exists firm_invoice_settings (
  firm_id uuid primary key references firms(id) on delete cascade,
  -- Free-form postal address block shown under the firm name on invoices.
  address text check (address is null or char_length(address) <= 500),
  -- One contact line (email · phone) under the address.
  contact_line text check (contact_line is null or char_length(contact_line) <= 200),
  -- Which tax components this firm's invoices offer (see lib/tax/canada.ts).
  -- Vylan's market is Quebec accounting firms, hence the default.
  province text not null default 'QC'
    check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  -- Tax registration numbers, displayed on invoices next to the matching tax
  -- line when present. gst_number covers GST and HST (same registration);
  -- qst_number is Quebec's TVQ; pst_number covers BC/SK PST and Manitoba RST.
  gst_number text check (gst_number is null or char_length(gst_number) <= 50),
  qst_number text check (qst_number is null or char_length(qst_number) <= 50),
  pst_number text check (pst_number is null or char_length(pst_number) <= 50),
  -- Invoice numbering: number = prefix + zero-padded sequence, frozen onto the
  -- invoice at creation. next_invoice_seq is the NEXT number to assign; the
  -- owner can raise it to continue an existing sequence from other software.
  invoice_prefix text not null default 'INV-'
    check (char_length(invoice_prefix) <= 12),
  next_invoice_seq bigint not null default 1 check (next_invoice_seq >= 1),
  -- Per-invoice-editable defaults.
  default_terms text check (default_terms is null or char_length(default_terms) <= 300),
  default_notes text check (default_notes is null or char_length(default_notes) <= 500),
  default_taxes_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table firm_invoice_settings enable row level security;

-- Firm-scoped for members (same trust model as firms.service_prices: the
-- Invoicing settings UI + route are owner-gated in code; RLS enforces firm
-- isolation). INSERT carries the same firm check so a member can only create
-- their own firm's row. UPDATE must be member-wide (not owner-only) because
-- invoice creation bumps next_invoice_seq via allocate_invoice_seq() below,
-- and any member may create an invoice.
drop policy if exists firm_invoice_settings_select on firm_invoice_settings;
create policy firm_invoice_settings_select on firm_invoice_settings
  for select using (firm_id = public.current_firm_id());

drop policy if exists firm_invoice_settings_insert on firm_invoice_settings;
create policy firm_invoice_settings_insert on firm_invoice_settings
  for insert with check (firm_id = public.current_firm_id());

drop policy if exists firm_invoice_settings_update on firm_invoice_settings;
create policy firm_invoice_settings_update on firm_invoice_settings
  for update using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

-- Table-grant hardening (0650 pattern): anon gets NOTHING; no DELETE for
-- anyone (settings rows live as long as the firm).
revoke all on firm_invoice_settings from anon, authenticated;
grant select, insert, update on firm_invoice_settings to authenticated;

-- ── 2. Sequential number allocation ─────────────────────────────────────────
-- Atomically claims the next invoice sequence for a firm and returns it. The
-- single UPDATE serializes concurrent callers on the row lock, so two
-- invoices created at the same instant get consecutive, distinct numbers.
-- SECURITY INVOKER (default) on purpose: session callers go through RLS (a
-- firm can only ever bump its OWN counter — another firm's id matches zero
-- rows and returns null), and the service role (automation) bypasses RLS as
-- it does everywhere else. Returns null when the firm has no settings row
-- yet; callers create the row first, then retry.
create or replace function public.allocate_invoice_seq(p_firm_id uuid)
returns bigint
language sql
as $$
  update firm_invoice_settings
     set next_invoice_seq = next_invoice_seq + 1,
         updated_at = now()
   where firm_id = p_firm_id
  returning next_invoice_seq - 1;
$$;

grant execute on function public.allocate_invoice_seq(uuid) to authenticated;

-- ── 3. Real-invoice fields on payment_requests (Phase 2/3) ──────────────────
-- The existing row IS the invoice; these columns grow it. All nullable: a
-- null invoice_kind row is a legacy / simple invoice (pre-build, or created
-- while this migration wasn't applied) and keeps rendering exactly as today.
--   invoice_kind    'generated' (Vylan renders the PDF from line items) or
--                   'attached' (the accountant uploaded their own document —
--                   the existing flow, now recorded explicitly).
--   line_items      jsonb array [{description, quantity, unit_cents,
--                   amount_cents}] — amounts frozen in integer cents.
--   tax_breakdown   jsonb array [{component, label, rate_milli_pct,
--                   base_cents, amount_cents, registration_number}] — the tax
--                   lines EXACTLY as issued (a later rate/province/number
--                   change never rewrites an issued invoice).
--   subtotal_cents + tax_total_cents: frozen sums. amount_cents (existing)
--                   stays the charged grand total = subtotal + tax_total.
--   invoice_seq     the raw allocated sequence (uniqueness backstop below);
--   invoice_number  the display number (prefix + padded seq), frozen.
--   issue_date / due_date / invoice_terms / invoice_notes: document fields.
--   invoice_language: 'en' | 'fr' — the language the invoice (and PDF)
--                   renders in, defaulted from the client's portal language.
alter table payment_requests
  add column if not exists invoice_kind text
    check (invoice_kind is null or invoice_kind in ('generated','attached')),
  add column if not exists line_items jsonb,
  add column if not exists tax_breakdown jsonb,
  add column if not exists subtotal_cents bigint
    check (subtotal_cents is null or subtotal_cents >= 0),
  add column if not exists tax_total_cents bigint
    check (tax_total_cents is null or tax_total_cents >= 0),
  add column if not exists invoice_seq bigint,
  add column if not exists invoice_number text
    check (invoice_number is null or char_length(invoice_number) <= 32),
  add column if not exists issue_date date,
  add column if not exists due_date date,
  add column if not exists invoice_terms text
    check (invoice_terms is null or char_length(invoice_terms) <= 300),
  add column if not exists invoice_notes text
    check (invoice_notes is null or char_length(invoice_notes) <= 500),
  add column if not exists invoice_language text
    check (invoice_language is null or invoice_language in ('en','fr'));

-- Uniqueness backstop for numbering: even if two creations somehow carried
-- the same allocated sequence (e.g. the owner lowered next_invoice_seq into
-- an already-used range), the duplicate insert fails with 23505 and the
-- caller re-allocates — numbers can never collide within a firm. Partial:
-- legacy rows (null seq) are exempt.
create unique index if not exists payment_requests_firm_invoice_seq_uniq
  on payment_requests (firm_id, invoice_seq)
  where invoice_seq is not null;
