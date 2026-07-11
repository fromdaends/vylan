-- Demo mode: new firms created via the public signup flow are flagged
-- as demos until the founder converts them via a manual conversation.
-- Demos are pre-seeded with realistic sample data and feature-gated
-- (can't add real clients, can't send real emails/SMS) so the
-- accountant can poke around without producing real-world side effects.
--
-- DEFAULT false so every firm created before this migration ran stays
-- as a regular firm — the existing customer list does not get
-- retroactively converted into demos.

alter table firms
  add column if not exists is_demo boolean not null default false;

-- RLS already covers firms via firm_id scoping; no additional policy
-- needed because this column is read together with the rest of the
-- firms row.
