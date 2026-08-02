# Files v2 — Phase 0 audit & integration plan

Date: 2026-08-02. Audited before building the Files v2 spec (Home tab, AI
Organize, full-text search, visibility flag, Drive-style Browse).

## What exists today (verified in code, not assumed)

**Tabs.** `/files?tab=` with `Tab = "browse" | "settings"`, default `browse`
([page.tsx](../src/app/[locale]/(app)/files/page.tsx)). Every cross-link into
Browse (Clients page, engagement rows) uses `/files?client=…` with **no tab
param** — they rely on the default.

**Document model.** Three tables — `uploaded_files`, `final_documents`,
`imported_documents` — unioned by the `firm_documents` view
(security_invoker, RLS does the filtering). Browse axes (`browse_year`,
`browse_category` + manual-override flags), `folder_id` (custom folders,
migration 1100), soft delete via `deleted_at` enforced **in RLS** (1090), a
30-day recycle bin with SECURITY DEFINER restore/list functions.

**Custom folders.** `document_folders`: per-client tree, nesting, sibling-name
unique indexes, drag-and-drop everywhere including materialization of derived
year/category rows into real folders (shipped 2026-07-30/31, at the founder's
explicit direction). **This directly contradicts spec §7** — see Conflicts.

**Extracted text: DOES NOT EXIST.** The classification pipeline stores
`ai_classification` (type code), `ai_confidence` (numeric 4,3), and
`ai_extracted_fields` (jsonb key values — dates, issuer, amounts). No column,
table, or bucket anywhere holds document text; no tsvector/FTS artifacts
exist. The classifier is a vision call that returns structure, not a
transcript. §5 (content search) and §4 ("summarize the lease") cannot be
built on existing data — text capture must be added to the pipeline, and
backfill means re-reading old documents with the model (real API cost).

**Duplicate infra.** `content_hash` on `uploaded_files` (0270, unique per
engagement) and `imported_documents` (1070, unique per client), surfaced in
`firm_documents`. `final_documents` has no hash (firm-authored deliverables)
— the Organize duplicates bucket scopes to uploaded + imported.

**Audit log.** `activity_log` with `actor_type`/`actor_id`;
`logUserActivity` resolves the acting user itself from the session — so a
Team-activity feed can attribute correctly. Action registry in
[audit-actions.ts](../src/components/settings/audit-actions.ts) (raw codes
render if unregistered — burned twice before); every new action also needs
`action_<key>` strings in both locales. `/settings/audit` is the full log.
All `file_*` / `folder_*` actions already registered.

**Background jobs.** A real queue: `/api/cron/process-jobs` every 2 minutes,
job kinds include `classify_document`, `send_reminder`, `sync_quickbooks`, etc.
The Organize scanner and the FTS backfill become new job kinds — **no
vercel.json change needed** (nightly = a scheduled job row, the pattern
`spawn-recurrences` already uses).

**AI assistant.** Anthropic API (`ASSISTANT_MODEL = claude-sonnet-4-6`), max
5 tool rounds, engagement chat + general chat launcher
(`lib/ai/assistant.ts`, `app/api/assistant`, `app/api/engagement-chat/*`).
The action layer (`lib/ai/assistant-actions.ts`) is dormant behind
`ASSISTANT_ACTIONS_ENABLED`, fails safe to OFF. §4 = new **read** tools only;
the flag stays off, exactly as specced.

**Client-facing file surfaces** (the §6 enforcement points):
`app/api/portal/files/[id]` (+ `/thumb`), portal engagement-item queries,
client notifications. Firm-side preview exists at `/api/files/[id]`.

## Conflicts the spec must resolve

1. **§7 bans freeform folders; the founder demanded and shipped them.** Spec:
   "Freeform arbitrary folders must not be creatable anywhere." Reality: six
   hours of 2026-07-30/31 were spent building exactly that at the founder's
   insistence ("it is their files… they could create anything"). The spec
   predates that work. **Proposed default: custom folders stay**; §7's "New
   folder = guided year/category picker" is superseded — the + New menu keeps
   the existing folder creation, and year/category structure remains available
   through the derived rows and materialization.
2. **§7's drag rules are stale.** "Year/category only, never across clients"
   — shipped drag already does more (folders, nesting, materialization) and
   cross-client drops are structurally impossible (Browse is per-client).
   Keep shipped semantics; add the spec's additions that are genuinely new
   (drag onto Recently deleted = soft delete, keyboard, click-selection).
3. **§5 assumes extracted text exists.** It doesn't (above). Text capture is
   new pipeline work; backfill is a paid re-read of existing documents.
4. Housekeeping: migration prefix `1110` now exists twice (two sessions
   collided), joining the `0750`/`0990` duplicates that already break
   Supabase Preview CI on migration PRs. Not fixed here (never rename
   migrations without the founder).

## Integration plan

**§1 Tabs** — `Tab = "home" | "browse" | "settings"`, default **home**, BUT
any browse-state param (`client`, `folder`, `year`, `category`, `q`, `type`,
`status`, `sort`, `page`) implies `browse`. Zero existing links change.

**§2 Home** — four server components, all cheap:
- Recent files: `firm_documents` order by `created_at` desc limit 10 (add a
  `(firm scoping…, created_at)` index in the first migration if missing).
- Team activity: `activity_log` filtered to the file/folder action codes,
  limit 15, actor names joined once; "System" for null actors. Link to
  `/settings/audit`.
- AI Organize card: counts by bucket from `organize_suggestions` where
  status='open' (dormant-but-honest before §3 ships: hidden).
- At a glance: total docs + this-month (head counts via `count: "exact"`,
  which works with PostgREST aggregates disabled — same trick as
  `listDocuments`), filing status from the same source `FilingPanel` reads,
  pending-AI = open `classify_document` jobs.

**§3 Organize** — migration: `organize_suggestions` (firm_id, client_id,
source+doc_id, bucket ∈ low_confidence|misfile|duplicate|unprocessed,
`current` jsonb, `proposed` jsonb, reasoning, doc_fingerprint for expiry,
status ∈ open|approved|skipped|dismissed; dismissed rows persist so the same
file+issue never reappears; suggestions whose fingerprint no longer matches
are expired at read time). Scanner = job kind `organize_scan` (nightly
scheduled row + on-demand from the card), **reads only**, service-role reads
must filter `deleted_at is null` explicitly (RLS won't do it for them).
Buckets from existing data, no new model calls: confidence < 0.60;
misfiles via `ai_extracted_fields` dates + `lib/files/axes` trusted-type
logic vs. current browse axes; duplicates via `content_hash` groups per
client; unprocessed via never-classified rows. Review queue at
`/files?tab=home&review=…` (or `/files/organize`): row = current → proposed +
one-line reasoning + preview toggle; Approve/Skip/Dismiss + per-bucket bulk
with an exact-consequences confirm. Approvals call the **existing** manual
actions (`moveDocumentAction`, `softDeleteDocument`, re-enqueue classify)
with `ai_suggested: true` in metadata — audit + Team activity for free,
attributed to the approving user.

**§6 Visibility** (built EARLY — §5 must filter on it):
migration adds `visibility text not null default 'client' check (visibility
in ('client','firm'))` to all three tables; `imported_documents` default
**'firm'**; view recreated with the column. Kebab + bulk toggle → new audit
actions `file_visibility_changed` (+ registry + EN/FR). Enforcement in the
portal routes and client-facing queries at the query layer; "Firm only"
badge in Browse and preview.

**§5 FTS** — migration: `unaccent` extension + `document_texts` (source,
doc_id, firm_id, client_id, text capped ~20k chars, `tsv` generated as
english ∥ french `to_tsvector` over unaccented text; GIN index). Pipeline:
the existing classification call additionally returns a transcript (one call,
more output tokens — no second model call). Backfill: job kind
`extract_text_backfill` walking existing docs through the same extraction
with progress logging (cost note: at current volume, small; needs the
founder's OK — see Questions). Browse search: name/metadata matches (current
behavior) + content matches with `ts_headline` snippets, labeled by type;
query filters `deleted_at is null` + visibility.

**§4 Chat file reading** — two new read tools: `search_documents` (name +
FTS + metadata) and `read_document` (extracted text + metadata by id), firm
session only, responses cite files as Browse/preview links. Asked to
move/rename/delete → decline + deep-link to Organize. `ASSISTANT_ACTIONS_ENABLED`
untouched.

**§7 Drive UX** — invocation layer only: row density to ~52px, + New button
(Radix menu, scale+fade like the shipped right-click menus) replacing
"Import files" with context-aware items (Import files / Upload files /
New folder); quick upload = two-step collapse of the import wizard backend
(client picker → classify pipeline, Imported badge, dedupe, audit — no raw
uploads); click-to-select feeding the existing BulkBar (Esc clears,
double-click opens, Ctrl/Shift multi-select, arrows/Enter/Delete), drag onto
Recently deleted = soft delete with undo toast. Same actions, same audit
events, new triggers only.

## Build order & migrations

1. §1 + §2 (tabs, Home minus Organize card) — migration **1130** (indexes
   only, if needed)
2. §6 visibility — migration **1140**
3. §3 Organize — migration **1150**
4. §5 text capture + FTS + backfill — migration **1160**
5. §4 chat reading (depends on 4)
6. §7 Drive UX pass
7. Organize card fully live on Home

(1120 skipped to stay clear of the duplicated 1110 pair.) Protocol per
project rules: every migration is applied to prod by the founder **before**
its PR merges; migration PRs are never auto-merged.

## Open questions (defaults proposed)

1. **Custom folders vs. §7's ban** — default: keep custom folders, treat the
   spec line as stale (it predates 2026-07-30).
2. **FTS backfill cost** — default: re-read existing documents through the
   extraction call once (batched, logged, capped); at current document volume
   the cost is small. Alternative: forward-only indexing, old files matched
   by name/metadata only.
