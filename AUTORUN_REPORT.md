# AUTORUN REPORT: Big Pass (unattended run, 2026-06-09)

This file is the running log of the autonomous big-pass session. Everything I would normally say out loud is here instead. Plain English first; file paths included so a later supervised session can jump straight to the code.

Status legend: DONE / IN PROGRESS / SKIPPED / NOT STARTED.

| Workstream | Status |
| --- | --- |
| Phase 0 verification | DONE |
| A. Unified status engine + stuck Analyzing chips | NOT STARTED |
| B. Overview hierarchy rework | NOT STARTED |
| C. Needs attention 2.0 | NOT STARTED |
| D. Team page: Edit firm + seat caps | NOT STARTED |
| E. Duplicates everywhere | NOT STARTED |
| F. Browser QA sweep | NOT STARTED |

---

## Phase 0: verification findings

### 1. Git and deploy plumbing: WORKING

- Remote: github.com/fromdaends/vylan (renamed from "relai"; the old URL still redirects). gh CLI is authenticated (account zacharythresh-ship-it) and can create PRs.
- Branch `autorun/big-pass` created off main and pushed.
- Vercel IS connected with auto-build on push: the `vercel` bot comments on every PR with the preview link, and `vercel.json` exists (3 cron jobs: process-jobs every 2 min, demo-leads every 5 min, purge-deleted nightly). The preview URL will appear as a Vercel bot comment on the PR.
- Baseline on untouched main: typecheck PASSES, all 769 unit tests PASS, production build PASSES. (One false alarm: tests failed before `npm install` because main recently added the `fflate` package; installing fixed it. Nothing was wrong with the code.)
- Browser tooling note: there is no MCP server literally named "Playwright" in this environment. What IS available: the Claude Preview toolset (a Playwright-backed browser driving a local dev server: click, fill, snapshot, console logs, screenshots) and a Chrome extension bridge for live URLs. Spot-checks and Workstream F will use these. If the Chrome bridge has no connected browser at QA time, the sweep runs against local dev, which the rules allow.

### 2. Engagement status: computed in 5 different places, two different rule sets

The stored database column `engagements.status` only knows: draft, sent, in_progress, complete, cancelled. Nothing ever moves it to a "ready to review" value; the only automatic transition is sent -> in_progress on the first client upload (src/lib/db/portal.ts).

Separately, a derived flag `readyToReview` is computed from checklist state: all required items non-pending AND at least one submission awaiting a decision (isReadyToReview in src/lib/attention.ts:173).

Who reads what today:

| Surface | Reads | File |
| --- | --- | --- |
| Engagement header pill | stored status | src/app/[locale]/(app)/engagements/[id]/page.tsx:189 |
| Overview table pill | stored status | src/components/dashboard/engagements-worklist.tsx:550 |
| Sidebar "Ready to review" bucket + badge | derived readyToReview | src/lib/engagements/views.ts:81, src/lib/dashboard/worklist.ts:153 |
| Sidebar highlight on detail pages | derived readyToReview first, then stored status | src/lib/navigation/active-nav.ts:41 |
| Progress % | own formula in computeAttention | src/lib/attention.ts:54 |

### David Chen contradiction: CONFIRMED, cause pinned

"TEST - Personal Tax 2025": 3 required items all submitted (2 approved, 1 awaiting decision), 2 optional untouched.
- Sidebar bucket: readyToReview = true (0 required pending, 1 submission awaiting) -> files under "Ready to review". Correct.
- Header + table pill: stored status = in_progress (set on first upload, never advanced) -> "In progress". Stale.
- Progress: counts submitted as done, so 3/3 required = 100% next to the "In progress" pill.

The fix (Workstream A): one server-side derivation that layers "ready to review" on top of the stored lifecycle status, read by every surface. The natural home is a new pure helper next to src/lib/attention.ts, threaded through loadEngagementWorklist (which already feeds the Overview table, sidebar buckets, and badge via one cached query) and through the engagement detail page (which already loads the same items).

### 3. Stuck "AI Analyzing..." chips: cause pinned

The chip renders whenever `ai_classification` or `ai_confidence` is NULL on the file row (src/components/engagements/ai-badge.tsx:60). NULL can mean "analysis in flight" OR "analysis never ran and never will" (skipped: missing API key, firm daily/monthly AI quota exceeded, download failure, silent error in the async callback). Skips are not persisted anywhere, so a 23-day-old skipped file is indistinguishable from one analyzed 5 seconds ago. Approving a file deliberately does not touch the AI fields, so approved files keep showing "Analyzing...".

Fix direction (Workstream A): (1) UI guard: a file with an accountant decision (approved or rejected) never shows Analyzing; (2) UI guard: a NULL-analysis file older than a freshness window shows a neutral "Not analyzed" instead of an animated spinner; (3) decide during implementation whether a data fix is still needed on top (it may not be, which would keep the shared DB untouched, the safest outcome).

### 4. Overview structure: a rearrange, not a rebuild

The dashboard page (src/app/[locale]/(app)/dashboard/page.tsx) is a vertical stack inside a two-column grid (main column + 320/360px sticky right rail):
Header -> JumpBackIn -> NeedsAttention (capped at max-w-[80rem]) -> TemplatesGallery -> EngagementsWorklist -> (What's new inline on mobile) | What's new rail.

- Needs attention already defaults EXPANDED (collapse state persisted in localStorage). It already shows up to 5 rows + View all. It is NOT beside Jump back in; both are full-width stacked blocks.
- The What's new rail is its own `aside`; the rework does not need to touch it at all.
- The table's Due column reads `engagements.due_date`.

### 5. Due dates: settable at creation only, GAP LOGGED

`engagements.due_date` exists since the first migration. The ONLY write surface is the new-engagement form (src/components/engagements/engagement-builder.tsx:268). There is no way to set or change a due date after creation, anywhere. Per the decision defaults: the Due column stays, nothing new gets built for editing due dates in this run. FOUNDER DECISION NEEDED LATER: add an edit-due-date control on the engagement detail page (small, contained feature).

### 6. Needs attention 2.0 signals: all five are computable from EXISTING data

- Ready to review: exists (isReadyToReview).
- Flagged files to review: computable from uploaded_files (ai_rejected, ai_usability, review_status='pending' meaning no accountant decision yet) + request_items.ai_rejection_count for the "flagged twice" notion. Lives today only in the preview model client-side; needs a server-side count.
- Signed copy to confirm: computable: request_items.kind='signature' with an uploaded file whose review_status='pending'.
- Sitting unreviewed > 3 days: computable: files with review_status='pending' and uploaded_at older than 3 days (uploaded_at IS the moment it started waiting).
- Quiet engagement: exists ("stale", threshold 5 days, src/lib/attention.ts:140). Keeping 5 days per the brief.

Initial read: NO new migration is required for Workstream C. The loadEngagementSignals query needs to select more columns from uploaded_files than it does today (currently only engagement_id + uploaded_at). Will confirm during implementation.

### 7. Team page seats: the "5" is the TRIAL plan cap, not a hardcode

- Caps resolve via resolveSeatCap(plan, seat_cap_override) in src/lib/billing/seats.ts:41; override wins, else PLANS[plan].maxUsers in src/lib/plans.ts: trial=5, solo=1, cabinet=10, cabinet_plus=15.
- The current firm is on the default 'trial' plan, hence "1 of 5 seats". seat_cap_override column already exists (migration 0190), service-role-only, NULL for everyone.
- Wiring per decision defaults: solo 1 -> 2, cabinet 10 -> 6, cabinet_plus stays 15. Trial stays 5, so the current firm's effective cap is preserved WITHOUT writing any override (the decision default about setting override=5 was written for a firm with no plan; this firm has plan='trial', so no DB write is needed). seats.test.ts expectations must be updated with the new numbers.
- Firm settings (logo, name, brand color, client language) live on /settings under the Account tab, owner-gated server-side in src/app/actions/settings.ts:28. The Edit firm button on Team links there; staff never see it and the server gate already exists.

### 8. Duplicates tab: cause pinned, two-part gap

- Render condition: the tab only renders when the engagement has at least one detected duplicate (`hasDuplicates`, src/components/engagements/engagement-preview/preview-overlay.tsx:119). Deliberate at the time (PR #502) "so most previews don't carry a 0", but it contradicts the other tabs (Looks good / Flagged always show with 0) and reads as inconsistent. Fix: always render with count.
- Detection coverage: detection is hash-based (SHA-256 content_hash, migration 0270) and runs on every NEW upload in every engagement, but files uploaded BEFORE the feature shipped have content_hash=NULL and are skipped as comparison candidates. So engagements whose uploads predate the feature can never show duplicates among those files, and a new upload cannot match an old hashless file either. That is why exactly one engagement (with post-feature uploads) shows the tab today.
- Fix direction: always-show tab (pure UI); plus a self-draining backfill that hashes legacy files a few at a time (additive column updates only; the existing process-jobs cron is a natural carrier). Retroactively MARKING old files as duplicates of each other re-buckets already-reviewed documents; that is a data-semantics change I will NOT do in an unattended run. New uploads will detect against backfilled hashes going forward. Logged as a decision below.

### 9. Decision defaults acknowledged

Sitting-unreviewed threshold 3 days; seat caps Solo 2 / Cabinet 6 / Cabinet+ 15 with override respected; status-engine edge cases as specified (zero-required engagements count as Ready once a submission awaits a decision; all-approved stays Ready with Mark complete; conservative bias toward surfacing work); Due column stays with no new setter; QA bans absolute.

---

## Decision log

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D1 | npm install before baseline (lockfile was ahead of node_modules) | main added fflate; baseline must reflect main | package-lock.json (no change by me) |
| D2 | Workstream D will NOT write a seat_cap_override for the current firm | firm is on plan='trial' whose cap stays 5; effective cap unchanged without any DB write | src/lib/plans.ts |
| D3 | Workstream E will NOT retroactively mark legacy files as duplicates | re-bucketing already-reviewed documents is a data-semantics change too risky without supervision; hash backfill + on-upload detection covers the future | src/lib/duplicates.ts |

(More decisions appended as workstreams complete.)

## Commits

- (this commit) Phase 0 findings + report skeleton.

## For the founder: check these when you're back

(filled in at the end of the run)
