-- THE FIRM'S STANDARD TERMS OF SERVICE, written once.
--
-- The founder, looking at an empty Terms box on every new template: "shouldnt
-- general terms fill automatically? Like a preset loaded".
--
-- Yes — and it is the difference between a feature and a chore. A firm's terms
-- are the same on every engagement; retyping or re-pasting them into each
-- template is the exact work a template is supposed to remove. Canopy solves
-- the same problem by letting you link a letter template.
--
-- ONE TEXT COLUMN, NOT A TABLE. A firm has exactly one set of standard terms —
-- there is no list to name, order or choose between. If that ever stops being
-- true (per-service terms, say, which Canopy does have) this becomes the
-- default and the variants get their own table; nothing here blocks that.
--
-- COPIED, NEVER REFERENCED. A template that loads these takes a COPY into its
-- own payload, the same rule as services and client requests. Editing the firm
-- default must never rewrite the terms a client already agreed to.

alter table if exists public.firms
  add column if not exists default_engagement_terms text;

comment on column public.firms.default_engagement_terms is
  'The firm''s standard terms of service, loaded into a new engagement template''s Terms tab. COPIED into the template''s payload on use — editing this must never rewrite terms a client already agreed to.';
