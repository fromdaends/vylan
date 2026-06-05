-- Strip em dashes from the built-in templates' names + item text.
--
-- Em dashes read as AI slop and we don't want them anywhere — not on the
-- templates page, and not in the request items a template seeds (which clients
-- see in the portal). The app already collapses "X — Y" to "X Y" at render
-- time as a safety net, but this fixes the underlying data so exports, the
-- template editor, and freshly-seeded engagement items are clean too.
--
-- regexp_replace with ' *— *' collapses the em dash plus any adjacent spaces to
-- a single space (handles "X — Y", "X—Y", "X  —  Y" alike). It targets the
-- em-dash char (U+2014) only, so real hyphens like "RL-1" are untouched.
--
-- Idempotent + order-independent: the WHERE clause only touches built-in rows
-- (firm_id is null) that still contain an em dash, so running this before or
-- after the 0170 templates — or re-running it — is safe and a no-op on
-- already-clean rows.

update templates
set
  name = regexp_replace(name, ' *— *', ' ', 'g'),
  items = regexp_replace(items::text, ' *— *', ' ', 'g')::jsonb
where firm_id is null
  and (name like '%—%' or items::text like '%—%');
