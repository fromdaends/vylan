# Competitor-audit fixes — phased roadmap

Source: original "Prompt B — P1 Audit Fixes + Profile/Logo Upload" planning doc
from 2026-05-13. Phases 1 + 2 shipped. Phases 3-7 remain. This file is the
durable memory of the plan so any future session can pick up where the last
one left off without re-deriving scope.

If `docs/multi-user-audit.md` exists, its Findings A and B (RLS column-update
gaps) should be fixed BEFORE Phase 6 (MFA) — they sit in the same auth/
identity surface, and fixing them first means Phase 6 doesn't have to revisit
the same migrations.

---

## Status

| # | Title | Status | PR / commit |
|---|---|---|---|
| 1 | Branding upload primitives (`sharp`, `processImageUpload`, `uploadBrandingImage`) | ✅ Done | PR #10 |
| 2 | User profile + top-right dropdown + `/app/profile` | ✅ Done | PR #11 (then reshaped by PR #20) |
| 3 | Firm logo upload (onboarding step 1 + settings/profile UI) | ⏳ Pending | — |
| 4 | T1135 + T2125 added to AI doc-type vocab + T1 template | ⏳ Pending | — |
| 5 | PII fix in `activity_log` (drop filenames) + dev-mode email/SMS log redaction | ⏳ Pending | — |
| 6 | MFA for accountants (TOTP via Supabase) | ⏳ Pending | — |
| 7 | Bulk file download (ZIP) + one-click firm data export | ⏳ Pending | — |

---

## Cross-cutting rules (apply to every phase)

- New strings live in `messages/en.json` AND `messages/fr.json`. French is the
  default locale. No hardcoded strings in components.
- New server actions validate input with Zod.
- New DB queries go through `src/lib/db/*.ts`.
- New tables/columns get RLS policies scoped to `firm_id`.
- File uploads go through `uploadObject` in `src/lib/storage.ts`.
- New routes are protected by the same auth gate as the rest of `/app/*`
  (the `(app)/layout.tsx` redirect chain).
- Activity-log writes go through `src/lib/db/activity.ts`.
- Multi-session protocol from `CLAUDE.md` applies — lock files, pull-rebase
  every 15-20 min, never auto-resolve conflicts.

---

## Phase 3 — Firm logo upload

**Why:** `firms.logo_url` has existed since Phase 2 of the original Relai
build but nothing writes to it. The Phase 1 primitives are ready to wire in.

**Scope**

1. **Onboarding step 1** (`src/app/[locale]/onboarding/step1-form.tsx`)
   - Add a logo upload field. Optional. Explicit "Skip — add later" link
     below the upload control.
   - Audit Item 5 fix: make firm name pre-fillable from the signup `name` if
     available, and give the brand color a "Use default" option so step 1
     never traps the user.

2. **Settings/Profile** (the firm settings are now on `/profile` per PR #20)
   - Add a "Branding" subsection under "Your firm" with:
     - Current logo preview (or fallback initials).
     - "Change logo" button — uses the same `uploadBrandingImage(.., "firm_logo")`
       action that user-avatar already uses (Phase 1).
     - "Remove logo" — clears `firms.logo_url` to NULL (storage object can
       stay, like avatar removal does).

3. **Display the logo wherever the firm appears prominently**
   - Top-left of `app-shell.tsx` (small 32×32 logo next to firm name).
   - The client portal header (`src/components/portal/portal-shell.tsx`).
   - Invite emails and reminder emails (`src/lib/email.ts`) — embed via signed
     URL (24h TTL is fine; emails are sent fresh each time).

4. **Migration check**
   - `firms.logo_url` likely already exists. If it does, no migration is
     needed. If it stores a signed URL instead of a path, change it to a path
     and generate signed URLs on read (mirrors how `users.avatar_path` works).

**Tests**
- E2E: upload logo in settings → see it on app shell + client portal preview.

**Deliverable:** I can upload a firm logo from onboarding OR settings, and it
shows up in the app, the client portal, and the emails.

---

## Phase 4 — T1135 + T2125

**Why:** Competitor-audit items 51 + 54. Canadian-tax positioning is weakened
by these missing. Trivial.

**Scope**

1. **Doc-type enum migration**
   - Add `t1135` and `t2125` to whatever enum/check constraint enforces
     `request_items.doc_type` and `uploaded_files.ai_classification`.
   - Use the multi-session migration-numbering rule (highest existing + 10
     buffer).

2. **AI classifier** (`src/lib/ai/classify.ts`)
   - Add `t1135` and `t2125` to `KNOWN_DOC_TYPES`.
   - Update the Sonnet system prompt to describe both:
     - T1135 = Foreign Income Verification Statement, for foreign property
       over $100K CAD.
     - T2125 = Statement of Business or Professional Activities, for
       self-employment income.
   - Verify the tool-output schema allows the new values.

3. **Built-in T1 template**
   - Add T1135 and T2125 line items to the T1 template seeded in
     `0005_builtin_templates.sql` (probably as a new migration that ALTERs
     or INSERTs into the templates table). Both should be `required: false`.
   - Bilingual labels:
     - T1135 EN: "Foreign Income Verification (T1135) — if foreign property > $100K CAD"
     - T1135 FR: "Vérification du revenu étranger (T1135) — si biens étrangers > 100 000 $ CAD"
     - T2125 EN: "Self-Employment / Business Income (T2125)"
     - T2125 FR: "Revenus d'entreprise ou de profession (T2125)"

**Tests**
- Unit test that the AI classifier accepts and returns `t1135` and `t2125`.
- The seeded T1 template now has 17 items instead of 15.

**Deliverable:** Create a T1 engagement, see T1135 and T2125 in the checklist.
Upload a sample T2125 PDF, see the AI badge classify it correctly.

---

## Phase 5 — PII fix in `activity_log` + dev-mode log redaction

**Why:** Competitor-audit Finding #4. Filenames frequently contain client PII
(e.g., `Jean_Tremblay_T4_2024.pdf`). The privacy policy commits to a 2-year
audit-log retention, meaning Relai silently stores 2 years of client name
data tied to firm IDs.

**Scope**

1. **Activity log scrubbing**
   - In `src/app/api/portal/upload/route.ts` (and any other place that writes
     to `activity_log` with PII):
     - Replace `metadata.filename` with `metadata.file_id` (the storage
       object UUID — no PII).
     - Keep `size_bytes` and `mime_type` — those are not PII.
   - For the engagement-detail UI: when displaying the activity log, look up
     the filename from `uploaded_files` by `file_id` at render time. The
     filename only appears as long as the file exists — not in the long-term
     log.

2. **Rejection reasons** (`request_items.rejection_reason`)
   - Don't change the schema — accountants legitimately need to write these.
   - Add a clear note to the rejection modal: "This message is shown to the
     client. Avoid including sensitive details."
   - Verify rejection reasons are NOT written into `activity_log.metadata`;
     remove if they are.

3. **Dev-mode console redaction** (`src/lib/email.ts` + `src/lib/sms.ts`)
   - When the Resend / Twilio key is missing and the helper logs "would send
     to ${to}", redact the address:
     - Email: `j***@example.com` (first letter + `***@` + domain).
     - SMS: `+1***-***-1234` (last 4 only).
   - Same pattern Stripe uses.

4. **Backfill migration**
   - One migration: backfill existing `activity_log` rows to remove
     `metadata.filename` where present. Don't backfill `file_id` for old rows
     — just NULL them out. The data isn't critical for old engagements.

**Tests**
- Unit test that the rejection modal's preview displays the warning string.
- Unit test that the dev-mode helpers redact correctly.

**Deliverable:** Activity log on a fresh engagement shows "Uploaded file" but
no client-name-bearing filename in the DB. Dev-console emails are redacted.

---

## Phase 6 — MFA for accountants

**Why:** Competitor-audit Item 65. Finance products without optional MFA fail
security reviews. Supabase has it built in — mostly UI.

**Scope**

1. **Profile page → Security section**
   - Add a "Two-factor authentication" section to `/profile`.
   - States:
     - **Not enabled** → "Set up two-factor authentication" button.
     - **Enabled** → "Two-factor authentication is on" + "Disable" button
       (requires password).
   - Set-up flow:
     1. `supabase.auth.mfa.enroll({ factorType: 'totp' })`.
     2. Show the QR code returned by Supabase.
     3. Show the secret as a fallback (copyable).
     4. Prompt for a 6-digit code from the authenticator.
     5. `supabase.auth.mfa.challenge` + `verify` to confirm enrollment.
     6. On success, show recovery codes. Make the user check a box "I have
        saved these."
   - Disable flow:
     1. Re-enter password.
     2. `supabase.auth.mfa.unenroll`.
     3. Toast.

2. **Login flow**
   - Detect when a user has MFA enrolled. After password login, if `aal` is
     `aal1` and a factor exists:
     - Redirect to `/login/mfa` (new page).
     - Prompt for 6-digit code.
     - `supabase.auth.mfa.verify`.
     - On success, redirect to `/dashboard` (or the original `redirectTo`).
     - On failure, show error, allow retry. Lock out after 5 failed attempts
       in 5 min (reuse the existing rate-limit helper).

3. **i18n**
   - All MFA strings in FR + EN. Use clean French
     ("authentification à deux facteurs" / "code de vérification").

**Tests**
- E2E: user enrolls MFA, signs out, signs in, gets prompted, enters code,
  lands on dashboard.
- E2E: wrong code → error → retry works.
- Unit test for the rate-limit lockout.

**Deliverable:** I can turn on MFA in my profile, sign out, sign in, and be
prompted for the code.

**Dependency note:** Findings A + B from `docs/multi-user-audit.md` should be
fixed first — they touch the same `users` + `firms` RLS policies that MFA
state may live on.

---

## Phase 7 — Bulk file download + one-click data export

**Why:** Competitor-audit Items 22 and 25. Both build on the same primitive:
stream a ZIP.

**Scope**

1. **ZIP streaming primitive** (`src/lib/zip.ts`)
   - Use `archiver` (stream-based, low memory). Add as a new dependency.
   - Function: `streamZip(entries: AsyncIterable<{ name: string; stream: Readable; size?: number }>): ReadableStream`.

2. **Bulk download on engagement page**
   - "Download all files (ZIP)" button on
     `src/app/[locale]/(app)/engagements/[id]/page.tsx` (top action bar).
   - Disabled if no files submitted yet.
   - New route: `src/app/api/engagements/[id]/files.zip/route.ts`.
   - Server:
     1. Auth + firm-scope check.
     2. Fetch all `uploaded_files` for the engagement.
     3. For each, mint a signed URL, stream into the ZIP.
     4. ZIP filename: `{client_name}-{engagement_title}-{date}.zip`
        (sanitized — no slashes, no leading dots).
   - Activity-log entry: `bulk_download`.

3. **Firm data export**
   - New route: `src/app/api/firm/export.zip/route.ts`.
   - Settings/Profile page → "Data & Privacy" section → "Export all my firm's
     data" button. Owner-role only (not staff).
   - Rate-limit to 1 export per firm per hour.
   - Generate CSVs:
     - `clients.csv` — id, name, email, phone, locale, type, notes,
       created_at, archived_at.
     - `engagements.csv` — id, client_id, title, type, status, due_date,
       sent_at, completed_at, created_at.
     - `request_items.csv` — id, engagement_id, label, description, doc_type,
       required, status, approved_at, rejection_reason.
     - `uploaded_files.csv` — id, request_item_id, original_filename,
       mime_type, size_bytes, ai_classification, ai_confidence, uploaded_at.
     - `activity_log.csv` — id, engagement_id, actor_type, action,
       created_at, metadata.
   - Also include all storage objects under their original paths:
     `files/{engagement_id}/{request_item_id}/{filename}`.
   - Stream the ZIP. Filename: `{firm_name}-export-{ISO date}.zip`.
   - Activity-log entry: `data_export`.

4. **Copy**
   - In Settings → "Data & Privacy" section, add:
     - "Your data is yours. Export everything as a ZIP, any time."
     - The export button.
     - A separate "Delete my firm" link (opens a mailto: to support@; full
       delete flow is future work).

**Tests**
- E2E: fake engagement with 3 uploaded files → click "Download all" → ZIP has
  3 files with correct names.
- E2E: Settings → export data → ZIP contains all 5 CSVs + the files folder.
- Unit test: ZIP filename sanitization (no slashes, no leading dots).

**Deliverable:** Both buttons work. Test the firm export on a seeded firm with
3 clients, 5 engagements, 8 files.

---

## After Phase 7

1. Update `docs/competitor-audit.md` — flip status of closed items from ❌/🟡
   to ✅. Append a "P1 closeout" section noting which audit items this set
   of phases addressed.
2. Update `LAUNCH_CHECKLIST.md` — check off items 22, 25, 65 (and any others)
   that are now done.
3. Run the full test suite. Post a final summary using the
   plain-English template from `CLAUDE.md`.

---

## Intentional exclusions (do NOT build in these phases)

From the original audit prompt's Section 4 intentional-exclusions list:

- E-signature
- Tax-return preparation
- Invoicing the firm's clients (Stripe is for billing the firm, not its clients)
- Real-time chat between accountant and client
- Native mobile apps
- CRM with pipelines/stages
- Proposals / engagement letters
- Time tracking
- Email-as-task / shared inbox
- KBA-verified signatures
- Multi-firm marketplace
- IRS / CRA transcript integration
- Bookkeeping ledger / general accounting features

If any of these somehow appear in the codebase, flag as scope creep.

---

## What's NOT in this roadmap

The competitor audit (`docs/competitor-audit.md`) flagged these 🚫 gaps that
intentionally stayed out of this phase plan:

- Email delivery monitoring (needs production Resend setup decisions first).
- `/engagements` list page (medium-sized; deferred for real user feedback).

Both can be picked up when the founder is ready.
