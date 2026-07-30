# Files section — Phase 0 audit

Read-only inventory of everything the Files section has to sit on top of, done
before any code, per the founder's spec. Every claim below was read out of the
repo on 2026-07-30 (main @ 8d0806a7); nothing here is assumed.

The headline: **four of the spec's premises do not hold against the current
codebase.** Two are cheap to design around, two need a founder decision before
section 7 (Import) can be built at all. They are marked 🔴 / 🟠 below.

---

## 1. Where documents actually live

Two tables hold client documents, plus one ledger that records what left for
cloud storage.

### `uploaded_files` — everything a client sends in

Created in `0001_init.sql:124`, extended by 0029 / 0240 / 0270 / 0280 / 0990.

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `request_item_id` | **NOT NULL**, `on delete cascade` from `request_items` |
| `engagement_id` | **NOT NULL**, `on delete cascade` from `engagements` |
| `storage_path` | object in the private `client-uploads` bucket |
| `original_filename` | what the client's file was called |
| `display_name` | AI-cleaned name, e.g. `T4 - 2024 - Hydro-Quebec.pdf`; NULL until confidently classified. Every reader does `display_name ?? original_filename` |
| `mime_type`, `size_bytes` | |
| `ai_classification` | doc type code, NULL until classified |
| `ai_confidence` | 0–1 |
| `ai_extracted_fields` | jsonb: `extracted_year`, `issuer_name`, `party_name`, `account_or_period`, `document_date` |
| `ai_usability`, `ai_rejected` | quality verdict + whether it auto-bounced |
| `review_status` | `pending` \| `approved` \| `rejected` |
| `rejection_reason`, `reviewed_by`, `reviewed_at` | |
| `content_hash` | sha256 of the bytes (0270) |
| `is_duplicate`, `duplicate_of_file_id`, `possible_duplicate_of_file_id` | |
| `uploaded_at`, `uploaded_by_ip` | |

There is **no `client_id`** — the client is reached through
`engagement_id → engagements.client_id`.

### `final_documents` — the firm's own deliverables (0620)

Separate table. No classification, no review status. Invoice PDFs also live here
and are excluded from document flows by path (`isInvoiceAttachmentPath`,
`runner.ts:183`).

### `filed_documents` — the filing ledger (0900)

One row per document per filing run, with `folder_path`, `filed_name`,
`provider_file_id`, `provider_link`. This is what the preview panel's
"Filed to Google Drive → path" line reads. `source` is `'checklist'`
(= `uploaded_files`) or `'final'` (= `final_documents`).

---

## 2. 🔴 Year and category are not stored anywhere

This is the biggest structural finding, and it drives most of the plan.

The spec's drill-down is `Clients/{client}/{year}/{category}` — the firm's
default folder template (`firm_filing_settings.folder_template`, 0900). But
**neither axis is a column.** Both are computed at filing time, in TypeScript:

* **year** — `resolveYear()` (`src/lib/filing/tokens.ts:194`) walks a chain:
  year printed on the document → `engagements.tax_year` → a single unambiguous
  `20xx` in the engagement title → the due date's year → `null`, which renders
  as the localized `Unsorted` / `Non classé` folder.
* **category** — the doc type's *group* (`federal`, `quebec`, `credits`,
  `forms`, `bookkeeping`, `other`) from `DOC_TYPE_LABELS`
  (`src/lib/doc-types.ts:34`), and **only when confidence ≥ 0.5** — below that,
  or for `unknown`/`other`, it is `Unsorted` too (`tokens.ts:43`).

Two consequences:

1. **Server-side pagination is impossible on a value computed in TypeScript.**
   The spec requires it ("assume thousands of documents per firm"), and grouping
   by year/category is the whole Browse UI. Computing on read means loading
   every row.
2. **Move has nowhere to write.** "Reassign year and/or category" needs a
   persisted override; today there is no field that survives a page reload.

**Plan: denormalize both onto the row.** Add `browse_year int`,
`browse_category text`, and `browse_year_manual` / `browse_category_manual`
booleans. The classify worker writes the derived values (reusing
`resolveYear` + the group map — one source of truth, no SQL copy of the
doc-type table); Move writes the manual values and flips the flag so a later
re-classification never silently undoes a human's decision. Browse then
filters, groups, sorts and paginates in plain SQL.

The migration needs a **Node backfill** (not pure SQL) for existing rows,
because the doc-type → group map only exists in TypeScript.

**Related subtlety worth confirming:** a document that has already been filed
to Google Drive is in a folder named after its *old* year/category. Move changes
Vylan's structure; it does **not** move the copy in the firm's Drive (the
`filed_documents` partial unique index means it is never re-filed). Recommended
behaviour: leave the cloud copy alone and say so in the UI. Flagging because a
firm could reasonably expect otherwise.

---

## 3. 🔴 `uploaded_files` has no soft delete

Today's delete is `deleteUploadedFilePermanently()`
(`src/lib/db/uploaded-files.ts:132`) and it is exactly what it says: the storage
object is removed and the row is `DELETE`d. Its own comment calls the absence of
a recycle bin deliberate.

It also does two things any soft-delete has to keep doing, or the checklist
silently lies:

* **duplicate promotion** — if other files were flagged as duplicates *of* this
  one, the oldest is promoted to be the real copy and un-rejected when the
  system (not a human) had rejected it as a duplicate.
* **`recomputeItemStatus()`** on every affected checklist item, plus clearing
  the item's stale AI set-assessment.

The pattern to copy is **engagements** (0139): `deleted_at` +
`deleted_by_user_id`, a 30-day window (`DELETED_RETENTION_DAYS`,
`src/lib/engagements/lifecycle.ts`), a `scope: "deleted"` filter that also
excludes rows *older* than the window (`engagements.ts:214` — they are
mid-purge and must not surface), and a purge cron at
`src/app/api/cron/purge-deleted-engagements`.

**The risky part is not adding the column — it is the exclusion sweep.** Every
existing reader of `uploaded_files` must gain `.is("deleted_at", null)`, or a
deleted document keeps appearing in the client portal, the engagement page, the
archive ZIP, the AI set assessment, and the filing runner (the spec explicitly
requires excluding soft-deleted files from re-filing jobs). That sweep is the
main correctness work of the delete feature.

---

## 4. Audit log — ready, but nothing file-shaped is registered

`activity_log` + `logUserActivity(firmId, engagementId | null, action, metadata)`
(`src/lib/db/activity.ts:314`). `engagement_id` **is nullable**, which is what
makes imported files (no engagement) loggable at all.

Registered actions live in `src/components/settings/audit-actions.ts`. It
already carries `bulk_download` and `data_export`, but **no per-file management
events** — nothing for rename, move, delete or restore.

That file's own comments record the trap: `recurrence_*` and
`team_offboard_reassigned` were logged for months without being registered, so
`/settings/audit` printed raw action codes. New events must be added to
`AUDIT_ACTIONS` **and** given `action_<key>` labels in `messages/en.json` +
`messages/fr.json` in the same PR.

Proposed names, consistent with the existing style: `file_renamed`,
`file_moved`, `file_deleted`, `file_restored`, `file_downloaded`,
`files_bulk_downloaded`, `files_bulk_deleted`, `documents_imported`.

---

## 5. 🟠 Permissions: "both roles see all files" is not what the database does

The spec says v1 lets owner and staff browse and manage all files. The database
disagrees, and it disagrees on purpose.

`uploaded_files` has no policy of its own — its 0002 policy gates through an
`EXISTS` join to `engagements`, so it inherits whatever the engagements policy
decides (0810's own notes say exactly this, and 0990 re-verified it table by
table). Which means today:

* a **private client**'s documents (0810) are invisible to staff;
* a **private engagement**'s documents (0850) are invisible to staff;
* **except** where that staff member is assigned to it (0990).

`final_documents` is stricter still — it gates on the `engagement_is_private()`
definer helper, which 0990 deliberately did not relax, so deliverables on a
private engagement stay owner-only.

**Recommendation: change nothing.** Browse reads through the RLS session client,
so this is automatic and correct — a staff member sees every file they can
already see, and "all files" is true within their existing visibility. The only
requirement is that no part of Browse, search, or the import wizard reaches for
the service-role client to "see everything", which would quietly punch a hole
through 0810/0850.

`can()` (`src/lib/auth/capabilities.ts`) is the capability chokepoint. Filing
settings is **owner-gated in app code today** — that gate has to survive the
move to the new tab.

---

## 6. Relocating Filing settings — easy, with one loose end

`/vylan` (`src/app/[locale]/(app)/vylan/page.tsx`) is a `?tab=` strip rendering
`<AutomatedJobsPanel />` or `<FilingPanel />`. `FilingPanel` is entirely
self-contained, so the move is: render it from `/files?tab=settings` and make
`/vylan?tab=filing` redirect.

**Loose end:** seven places hard-code `/vylan?tab=filing`, including the two the
OAuth flow actually lands on —
`src/components/filing/provider-card-actions.tsx:169` and
`src/components/filing/microsoft-picker.tsx:67` (`router.replace`) — plus the
command-palette entry (`src/lib/search/registry.ts:137`), the automated-jobs
panel card, and the "go connect" links in `file-to-storage-dialog.tsx`. All must
be repointed, otherwise connecting Google Drive from the new page throws the
firm back to the old one. `/integrations/filing` already redirects to
`/vylan?tab=filing`, so it will chain — worth collapsing to a single hop.

Also: with filing gone, `/vylan` has **one** tab left. The tab strip should
probably go rather than render a strip of one. Small call, flagging it.

Sidebar insertion point is `src/components/app/app-shell.tsx:145-146` —
`railNav`, between `/templates` and `/engagements`. There is a separate mobile
tab list in the same file that needs the same treatment.

---

## 7. 🔴 The Import wizard cannot browse Google Drive

Spec §7 Step 1–2: pick a connected provider (Google Drive first), browse its
folder tree, choose folders to import.

**Google Drive is connected with `drive.file` scope — and nothing else**
(`src/lib/filing/google/oauth.ts:16`). That scope means Vylan can only ever see
files and folders **it created itself**. It cannot list the firm's existing
Drive, cannot see their historical client folders, and cannot download them.
The file's own comment records why: `drive.file` is non-sensitive, so Google
requires **no restricted-scope verification and no CASA security assessment**.

**Dropbox is the same story** — the app is registered with App-folder access
(`src/lib/filing/dropbox/oauth.ts:3`), sandboxed to `/Apps/<app name>`.

**Microsoft is the exception.** It holds `Files.ReadWrite` +
`Sites.ReadWrite.All` delegated (`src/lib/filing/microsoft/oauth.ts:20`) — full
OneDrive and SharePoint access. It can browse and read the firm's existing
content today.

So the import wizard's provider ordering is upside down relative to what is
actually possible: **the one provider that can power it is the one the spec
lists last.** The spec's own fallback — local folder drag-and-drop — needs no
new OAuth at all and works today.

Widening Google would mean `drive.readonly`, a **restricted** scope: Google
brand/security verification plus an annual third-party CASA assessment (weeks
of process and real money). That is a business decision, not an implementation
detail, which is why it is stopping here for a founder call.

The connector interface also only has `ensureFolderPath` / `fileExists` /
`uploadFile` / `trashFileById` (`src/lib/filing/types.ts:55-85`) — there is no
list-children and no download. Import needs both added per provider.

---

## 8. 🟠 There is no "machine-readable fast path"

Spec §7: *"Machine-readable files follow the existing fast path (bypass AI
model, route straight to classification-by-parsing) to keep import cost near
zero."*

**That fast path does not exist.** Every document goes to the model;
`classify.ts:780` notes both providers read PDFs natively, which is precisely
why no parse-only route was ever written. `router.ts` routes *usability
verdicts*, not file types — it runs after the model, not instead of it.

So importing 5,000 historical files means ~5,000 classifier calls at the
current model settings (GPT-5.4, high-res, medium reasoning). Building the
parse-first path is a real change to the AI pipeline — which the spec's own
non-goals rule out ("No changes to the AI analysis pipeline").

Options, in order of my preference:

1. Import through the existing pipeline, and make Step 4's estimate an
   **honest cost + time estimate** rather than a note. Nothing new to build.
2. Import without classification; files land under `Unsorted`, and the firm
   classifies on demand from Browse. Cheapest, but undercuts the point.
3. Build the parse-first fast path as its own scoped piece of work, later.

---

## 9. 🔴 An imported file cannot be an `uploaded_files` row

`request_item_id` is `NOT NULL` with `on delete cascade`. An imported file has
no engagement and no checklist item, so it structurally cannot be a row in that
table without making two NOT NULL columns nullable — which would mean revisiting
every join and every `recomputeItemStatus` path in the app.

**Plan: a separate `imported_documents` table** mirroring the useful columns
(client_id, storage_path, names, mime, size, content_hash, the ai_* fields,
browse_year/browse_category, deleted_at). This makes the spec's hard rule —
*"importing must never satisfy or affect a checklist item"* — structurally true
rather than a discipline the next session has to remember. It also gives
"filing-exempt" for free: the filing runner only ever reads `uploaded_files` and
`final_documents` for a given engagement, so imports can never be pushed back
out to the storage they came from.

Browse then reads a **`firm_documents` view** unioning the sources into one
shape, so pagination/sort/search stay single-query SQL.
(Needs `security_invoker = true` so the view inherits the base tables' RLS
rather than running as its owner — verify against the prod Postgres version
before relying on it.)

Duplicate detection at import can reuse `content_hash` directly.

Progress that survives a reload has a precedent to copy:
`client_import_sessions` (`src/lib/db/client-import.ts`) with its
`claimClientImportSession` atomic claim, plus the `jobs` queue
(`src/lib/db/jobs.ts`) for the background run — a new `import_documents` kind
alongside the existing `file_to_storage`.

---

## 10. Reusable pieces (nothing here needs building twice)

| Need | Existing thing |
| --- | --- |
| Preview modal + PDF/image viewer | `src/components/engagements/engagement-preview/` (`preview-overlay`, `preview-doc-viewer`, `preview-pdf-thumb`, `preview-detail`) |
| Signed download URLs, batched | `signedDownloadUrl` / `signedDownloadUrls` (`uploaded-files.ts:235`) |
| Bulk ZIP download | the engagement archive path (already logs `bulk_download`) |
| Tab strip | `/vylan` page pattern (underlined `?tab=` strip) |
| Multi-step wizard | `/clients/import` |
| Background job + progress | `jobs` table + `/api/cron/process-jobs` |
| 30-day recycle bin | engagements `deleted_at` + purge cron |
| Year / category derivation | `resolveYear` + `DOC_TYPE_LABELS` groups |
| Filed-to-storage path for the preview panel | `filed_documents.folder_path` / `provider_link` |

---

## 11. Proposed build order

Migration numbering: highest on main is `1060_quickbooks_currency_prefs.sql`,
so this takes **1070** (+10 per the repo's multi-session rule).

Per the repo rule and the past outage, **1070 is hand-merged** — the founder
applies the SQL to prod *before* the PR merges.

1. **PR 1 — schema + data layer.** Migration 1070 (`browse_year` /
   `browse_category` / manual flags / `deleted_at` on `uploaded_files`;
   `imported_documents`; `document_import_runs`; the `firm_documents` view),
   the Node backfill for existing rows, the db module, tests. No UI.
2. **PR 2 — the Files surface.** `/files` route, Browse's three levels,
   search/filter/sort/server-side pagination, Filing settings tab (moved
   as-is), sidebar entry, and every redirect from §6. Code-only → auto-merge.
3. **PR 3 — management actions.** Preview, download, rename, move, soft delete,
   Recently deleted + restore, bulk variants, the audit events, and the
   soft-delete exclusion sweep across every existing reader (§3). Code-only.
4. **PR 4 — Import wizard.** Shape depends entirely on the §7 decision.

---

## 12. What I need from the founder before building

1. **Import source (§7).** Google Drive can't be browsed with today's grant.
   (a) local drag-and-drop only in v1, (b) Microsoft/SharePoint first since it
   works today, (c) start Google's restricted-scope verification + CASA.
   My recommendation: **(a) now, (b) next** — it ships the migration path for
   every firm without waiting on Google, and (c) can run in the background if
   Drive import matters commercially.
2. **Import cost (§8).** Accept per-file AI classification on import with an
   honest estimate in Step 4, or land imports unclassified?

Two smaller ones I will assume unless told otherwise:

3. **Final documents in Browse** — I will include them (they are firm documents,
   they already file to storage, and RLS keeps private ones owner-only), shown
   with a "Deliverable" badge and no source-engagement link ambiguity.
4. **Move does not move the cloud copy** (§2) — the file stays where it was
   filed; the UI says so.
