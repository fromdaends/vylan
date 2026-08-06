-- "Invoice when the client accepts" is allowed to be saved.
--
-- ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
--
-- The founder asked for a choice of WHEN the invoice goes out, and
-- 'on_acceptance' was added to the dropdown, to the zod schema, to the TypeScript
-- union, and to the acceptance hook that fires it (lib/engagements/on-accepted.ts
-- reads exactly this value). Everything downstream is built and waiting.
--
-- The DATABASE was never told. 0590 wrote:
--
--   check (invoice_auto_mode in ('off', 'on_completion', 'delayed'))
--
-- So picking the fourth option makes the INSERT fail, which fails the whole
-- engagement create — the accountant gets a generic "couldn't create" and loses
-- the form. Not a degraded feature: a broken save.
--
-- Confirmed against production before writing this: 63 engagements, 63 of them
-- 'off', and zero rows in any of the other three modes. Nothing has ever been
-- saved with it, which is exactly what a constraint rejection looks like.
--
-- ── WHY ONLY THE ENGAGEMENT COLUMN ─────────────────────────────────────────
--
-- 0590 put the same CHECK on `firms.default_invoice_auto_mode`. That one stays
-- as it is, deliberately: the firm-level default is typed to the three original
-- modes everywhere that reads or writes it (src/lib/db/firms.ts and
-- /api/firm/invoice-defaults), so nothing can send 'on_acceptance' to it. A
-- constraint that matches the code is not a bug, and widening it would permit a
-- value no code path can produce or consume.
--
-- ── APPLY-TIME NOTE ────────────────────────────────────────────────────────
--
-- Cannot fail on existing data: the new list is a strict superset of the old
-- one, so every row that satisfied the old CHECK satisfies this one. Verify
-- afterwards by saving an engagement with "when the client accepts" chosen, or:
--
--   select invoice_auto_mode, count(*) from public.engagements group by 1;
--
-- The constraint is dropped and recreated rather than added alongside, because
-- two CHECKs on one column both have to pass — leaving the old one would change
-- nothing at all.

alter table public.engagements
  drop constraint if exists engagements_invoice_auto_mode_check;

alter table public.engagements
  add constraint engagements_invoice_auto_mode_check
  check (invoice_auto_mode in ('off', 'on_completion', 'delayed', 'on_acceptance'));

comment on column public.engagements.invoice_auto_mode is
  'When the engagement''s invoice is raised. off = never automatically; '
  'on_acceptance = the moment the client agrees to the proposal (1720); '
  'on_completion = when the work is marked complete; delayed = N days after '
  'completion, per invoice_delay_days.';
