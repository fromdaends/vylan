-- A billing block's TIMING survives being saved.
--
-- ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
--
-- billing-blocks.ts lets an accountant say how AND when a group of services
-- bills: "$4,000, one time, on acceptance", or "$500/month starting on a date
-- you pick". The how survives. The WHEN is thrown away the moment it is saved.
--
-- flattenBlocks() writes each line's FREQUENCY onto engagement_items and drops
-- the block's own `timing` and start date; the frozen proposal keeps no copy
-- either. So the client's contract never says when the money is due, no charge
-- path could read it if it did, and "on acceptance" was a label with nothing
-- behind it — the same shape of broken promise the deposit was before 1680 and
-- the recurring lines were before 1710.
--
-- The engagement TEMPLATE builder already persists block timing, which is why a
-- template remembers what the engagement it creates forgets.
--
-- ── WHY IT LANDS ON THE LINE, NOT ON A BLOCK TABLE ─────────────────────────
--
-- Blocks are the AUTHORING shape; engagement_items are the rows everything
-- downstream reads (the invoice path, the totals panel, the recurring charge
-- runner, the proposal). 1450 made that choice deliberately and it has held.
-- Adding a blocks table now would give two sources of truth for one line's
-- price and one of them would drift.
--
-- Every line in a block inherits the block's timing exactly as it already
-- inherits its frequency, so a block is losslessly reconstructable from its
-- lines and nothing downstream needs to learn a new concept.
--
-- ── APPLY-TIME NOTE ────────────────────────────────────────────────────────
--
-- Purely additive; both columns are nullable and every existing row keeps
-- meaning what it means today. NULL timing reads as the old default: a one-time
-- line bills when the firm's invoice settings say, and a recurring line starts
-- at the engagement start. Nothing that bills correctly today changes.

alter table public.engagement_items
  add column if not exists billing_timing text
    check (
      billing_timing is null
      or billing_timing in (
        'on_acceptance',
        'on_completion',
        'engagement_start',
        'custom_date'
      )
    );

comment on column public.engagement_items.billing_timing is
  'WHEN this line bills, inherited from its billing block. on_acceptance / '
  'on_completion for one-time lines; engagement_start / custom_date for '
  'recurring ones. NULL = the pre-1740 default (invoice settings decide a '
  'one-time line; a recurring one starts at the engagement start).';

-- Only read when billing_timing = 'custom_date'. A recurring arrangement the
-- client agreed would start in the new year rather than on signing.
alter table public.engagement_items
  add column if not exists billing_start_date date;

comment on column public.engagement_items.billing_start_date is
  'First charge date for a recurring line whose block chose "a date you pick". '
  'Ignored for every other timing.';
