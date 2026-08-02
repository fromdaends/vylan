-- Questions: a checklist item the client answers in WORDS, not with a document.
--
-- Vylan has only ever asked clients for files. But the thing that actually holds
-- up a month-end close is not a missing file — it is a $340 charge nobody can
-- identify. There is no document that answers "what was this for?"; only the
-- client knows, and one sentence from them unblocks the entry.
--
-- A THIRD KIND, not a new table. A question is a request_items row: same
-- checklist, same portal, same status machinery, same reminders. What differs is
-- what satisfies it. `kind` already exists for exactly this reason (0260 added
-- 'signature' when the accountant supplies the document and the client returns a
-- signed copy), so this is the third point on a scale the model already has.
--
-- WHY THE ANSWER IS ITS OWN COLUMN and not a message, a note, or a file: it has
-- to sit beside the transaction it is about. The whole loop is ledger → question
-- → client → back to ledger, and the last leg only works if the firm can read
-- the answer next to the entry it explains. An answer in a message thread is an
-- answer somebody has to go and find.
--
-- Combined with ledger_txn (1120), a question row knows which transaction in the
-- client's books it is about — so the uncategorised screen can show the client's
-- own words next to the entry, and the firm codes it in one click.
--
-- Additive and safe: every existing row stays kind='collection', and both new
-- columns are null for everything that is not a question.
--
-- Reversible:
--   alter table request_items
--     drop column if exists answered_at,
--     drop column if exists answer_text;
--   -- (an enum VALUE cannot be dropped; 'question' would simply go unused)

-- (a) The new kind.
--
-- ADD VALUE IF NOT EXISTS is idempotent, so re-running this file is safe. It is
-- also the reason nothing in this migration USES 'question': PostgreSQL refuses
-- to use an enum value in the same transaction that added it, and a migration
-- that tripped over that would fail halfway with the columns half-created.
alter type request_item_kind add value if not exists 'question';

-- (b) The client's answer, in their own words, and when they gave it.
--
-- Free text on purpose. "It was the deposit for the Trois-Rivières job" is the
-- real shape of these answers; any attempt to make the client pick from a list
-- of the firm's account names would fail on the first client who does not know
-- what a chart of accounts is.
alter table request_items
  add column if not exists answer_text text;
alter table request_items
  add column if not exists answered_at timestamptz;

comment on column request_items.answer_text is
  'For kind = ''question'': the client''s written answer. Null until they answer.';

-- Verify after applying:
--   select id, label, kind, answer_text from request_items where kind = 'question';
--
-- Expect zero rows until the first question is sent.
