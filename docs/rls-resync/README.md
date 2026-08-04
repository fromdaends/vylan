# Prod RLS re-sync — 2026-08-04

## What was found

On 2026-08-04 (files-empty-diagnosis session) prod's `engagements_all` policy was
found to be the **0850 generation**:

```
(firm_id = current_firm_id())
AND (current_user_is_owner() OR coalesce(is_private,false) = false OR (assigned_user_id = auth.uid()))
```

That is the `0850_engagement_private.sql` shape. Four later rewrites of the same
policy — `0990_assigned_staff_can_see`, `1220_membership_grants_sight`,
`1240_only_the_list_can_see_it`, `1320_engagement_members` — are all **recorded
as applied in `supabase_migrations.schema_migrations`, but their policy text is
not live**. The membership/privacy wave the app is written against was never
actually enforced by prod.

### Why `db push` cannot fix this

The ledger already contains those versions, so the CLI considers them applied
and will never re-run them. The likely cause is an overwrite AFTER application:
policy DDL pasted into the SQL editor from an old migration or a "reversible:
restore the previous policies" comment block (several migrations carry those).
`drop policy` + `create policy` leaves no trace in the ledger.

**Lesson (also in `.active-sessions.md`): never trust "applied and verified"
for a policy migration without re-checking `pg_policies`.**

## The fix — two files, run in the Supabase SQL editor

Source of truth: the 159 migration files up to `1430_subtasks.sql`, replayed in
filename order by `tools/extract.js`. Final state: **96 policies on 71 tables**
(+ `jobs` and `demo_requests` deliberately RLS-on with zero policies, and one
`storage.objects` policy) and **13 helper functions** referenced by policies.

1. **`2026-08-04-audit.sql`** — read-only. Dumps the migration ledger, RLS
   flags, every policy in 160-char chunks (the SQL editor truncates wide cells;
   chunks survive), the 13 function bodies, and a per-table policy-count check
   against the repo. Run it BEFORE the re-sync (the "before" record) and after
   (the proof).

2. **`2026-08-04-resync.sql`** — the one-paste fix. Per table (alphabetical):
   enables RLS, drops + recreates every policy exactly as the migrations define
   it, drops any extra policy the repo does not define (recorded in the
   report), and re-asserts the 13 helper functions. The **last statement prints
   a report** of everything it changed, with the old definitions' md5s.

   Safety properties, by construction:
   - One paste = one transaction. Any error rolls back EVERYTHING.
   - Each table is atomic on its own: a table that errors (e.g. a column a
     pending migration would add is missing) is skipped whole — its old
     policies stay — and shows up as `SKIPPED` in the report.
   - Idempotent: a second run reports "already matched" everywhere.
   - Never touches data rows. Never drops tables, columns, or functions.
   - `storage.objects` (platform-owned): canon policy re-asserted; extra
     storage policies are only REPORTED, never dropped (they may be
     dashboard-made on purpose).

Both generated artifacts were validated with the real Postgres parser
(libpg_query via `pgsql-parser`): whole-file parse, all 86 DO bodies as
PL/pgSQL, and each of the 96 + 13 embedded DDL statements standalone.

## What being in sync turns ON

Prod has been running the 0850-era sight rules. After the re-sync, the rules
the app was built for are enforced, most visibly:

- **Staff only see clients/engagements they are on the list for** (1240): a
  non-owner with no `client_members` / `engagement_members` rows and no
  assignment loses sight of rows the stale policy was showing them. That is the
  designed behaviour, not a regression — check rosters are populated before
  running if staff accounts are in daily use.
- Owners are unaffected (`current_user_is_owner()` short-circuits everywhere).
- Related data fix handed to the founder separately: Cabinet Tremblay
  (`c7ea5737…`) has 27 engagements stranded `is_private = true`; under the
  correct policies those stay owner/member-only until the clearing SQL runs.

## `current_user_is_owner()` — verified against the post-1290 model

1290 made the Owner ROLE real (`firm_roles.is_owner_role` + triggers) but
deliberately kept RLS on the RANK: `users.role = 'owner'` (see 1290's header —
"not one permission moves"). So the canonical body is still 0190's, and the
re-sync re-asserts exactly that. If prod's body differs, the report prints
`function REPLACED` with the old body's md5 (the audit dump has the full text).

## Outcome — ran on prod 2026-08-04

First run (15:01Z): **0 policies fixed, 0 extras dropped, 0 skipped — and all
13 helper functions REPLACED (bodies differed)**. Second run (15:24Z): 0 fixed,
0 functions changed, 109 already ok. Idempotency proven; **prod matches the
repo exactly as of 2026-08-04T15:24Z.**

So the drift live at fix time was in the **helper-function bodies, not the
policy text**. All 96 policies already matched canon — including
`engagements_all`, which contradicts the 0850-generation reading from the
files-empty-diagnosis session. Either that reading was a misread (SQL-editor
cell truncation is the suspect — the same reason `audit.sql` chunks its
output), or the policies were spot-fixed during that morning's founder-run
round and only the functions stayed stale. Treat "the policies were
generations behind" as **unconfirmed**; "the checkers were stale" is what the
report proved. Stale checkers produce the same symptoms policy drift would:
every sight rule delegates its actual decision to these 13 functions.

The audit-before dump was not captured, so the old function bodies are gone;
their md5 prefixes survive in the first-run report screenshot (2026-08-04
conversation).

Standing rule: after any policy/function migration, verify `pg_policies` AND
`pg_get_functiondef` on prod — the migration ledger proves nothing about
what's live.

## Out of scope (deliberately)

- **Table GRANTs** (161 grant/revoke statements across migrations) — not
  re-asserted in v1; policy drift was the failure. If the audit output shows
  symptoms of grant drift, generate a grants pass next.
- **Non-policy functions** (RPCs like `firm_document_folders`, trigger
  functions) — not audited here.
- Deleting the two dead-by-design deny-all tables (`jobs`, `demo_requests`) —
  they stay, locked.

## Regenerating after new migrations

```
node docs/rls-resync/tools/extract.js supabase/migrations /tmp/out
node docs/rls-resync/tools/compose.js /tmp/out        # writes resync.sql + audit.sql
node docs/rls-resync/tools/validate.js /tmp/out       # needs: npm i pgsql-parser libpg-query
```

`extract.js` prints anomaly flags (unparsed policy DDL, DO blocks containing
policy DDL, tables with policies but no RLS enable). A clean run has two known
benign flags: `jobs` and `demo_requests` are RLS-enabled with zero policies.
