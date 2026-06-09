# AUTORUN REPORT: Big Pass (unattended run, 2026-06-09)

This file is the running log of the autonomous big-pass session. Everything I would normally say out loud is here instead. Plain English first; file paths included so a later supervised session can jump straight to the code.

Status legend: DONE / IN PROGRESS / SKIPPED / NOT STARTED.

| Workstream | Status |
| --- | --- |
| Phase 0 verification | DONE |
| A. Unified status engine + stuck Analyzing chips | DONE |
| B. Overview hierarchy rework | DONE |
| C. Needs attention 2.0 | DONE |
| D. Team page: Edit firm + seat caps | DONE |
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

## Workstream A: unified status engine + Analyzing chips (DONE)

What changed, in plain English:

1. There is now ONE rule, computed on the server, that decides what status an engagement shows. Every status pill in the app reads it: the engagement page header, the Overview table, the engagements lists, the sidebar buckets, and the pills on client pages. The David Chen case now shows "Ready to review" (a green pill) everywhere at once instead of "In progress" in one place and "Ready" in another.
2. The rule, exactly: an engagement that was sent shows "Ready to review" when no required document is still owed by the client (nothing missing, nothing sent back awaiting a re-upload) AND something awaits the accountant's decision. If every required document is already approved, it STAYS in "Ready to review" until the accountant clicks Mark complete (per the decision defaults). Draft, Complete, and Cancelled are untouched.
3. New green "Ready to review" pill style (success tint), clearly different from the gray "In progress".
4. The "AI Analyzing..." chip can no longer get stuck: a file the accountant already approved or rejected never shows it (their decision supersedes the AI), and a file whose analysis never finished within 15 minutes shows a calm "Not analyzed" label instead of an animated spinner, in both languages, with a tooltip explaining the accountant can still review it normally.

Where it lives: the rule is deriveEngagementStatus + isReadyToReview in src/lib/attention.ts; pill styling shared from src/lib/engagements/status-pill.ts; chip fix in src/components/engagements/ai-badge.tsx. New unit tests cover the David Chen case and every edge case in the decision defaults.

Verification: typecheck PASS, lint 0 errors, all 795 unit tests PASS (includes component render tests of the table pills), production build PASS. Browser spot-check note: this machine's .env.local has no Supabase keys, so a local dev server cannot reach the database; visual checks happen against the Vercel preview in Workstream F instead.

Behavior changes to be aware of (all deliberate, per the brief):
- An engagement whose required items are ALL approved now counts as Ready to review (it used to fall out of the Ready bucket entirely). It parks there until Mark complete.
- An engagement with a rejected required document (client owes a replacement) no longer counts as Ready to review even if another file awaits a decision; it reads In progress because the ball is in the client's court. Files awaiting review on such engagements will surface through Needs attention's "sitting unreviewed" chip (Workstream C).

---

## Workstream B: Overview hierarchy rework (DONE)

What changed, in plain English:

1. The Overview now reads in priority order: act first (Jump back in + Needs attention together in the top region), then your work (the My engagements table, moved up), then starting something new (the template strip, demoted to the bottom of the main column).
2. On a wide monitor (2xl breakpoint, 1536px and up) Jump back in and Needs attention share the first row side by side, which also fixes Jump back in floating alone in empty space. On laptops and phones they stack as before. When there is no recent engagement to jump back to, Needs attention takes the whole row by itself.
3. Needs attention still opens expanded by default, shows up to 5 rows plus View all, and shows the one-line "all caught up" message when empty. If the founder previously collapsed it on a device, that saved preference is still honored (collapsing it again works the same way).
4. The template strip is now visually quiet: a muted small heading, slim pill-shaped items (icon + name + document count) instead of big preview cards, and a subdued Browse all link. Same templates, same links, just clearly secondary.
5. The What's new rail was not touched: same component, same position, same behavior, on desktop and mobile.

Where it lives: src/app/[locale]/(app)/dashboard/page.tsx (ordering + top row), src/components/dashboard/templates-gallery.tsx (compact strip).

Verification: typecheck PASS, all 795 tests PASS (including the existing TemplatesGallery tests, which assert links and content that the compact strip preserves), lint 0 errors, production build PASS.

---

## Workstream C: Needs attention 2.0 (DONE)

What changed, in plain English:

1. Needs attention now surfaces everything that requires the ACCOUNTANT to act, not just quiet engagements. An engagement appears when any of these are true, each shown as its own small chip on the row:
   - Ready to review (green, from the Workstream A engine; says "N items ready", or just "Ready to review" when everything is already approved and only Mark complete remains)
   - Flagged files (amber, with the count: files the AI flagged or auto-bounced that still await the accountant's own call; a bounce the client already replaced does not count)
   - Signed copy to confirm (blue, with the count of signature items where the client returned a signed copy)
   - Waiting N days (amber hourglass: a submission has sat undecided for more than 3 days, the decision-default threshold)
   - The existing chase chips stay: overdue (red), due soon, and quiet (kept at the existing 5-day threshold)
2. One row per engagement, several chips when several reasons apply. Never duplicate rows.
3. Sorting is oldest-waiting-first: the engagement whose undecided submission has waited longest leads. Engagements with nothing undecided (purely overdue or quiet) follow, most urgent first.
4. Clicking a row opens the engagement. Rows whose reason is flagged files open the engagement with the Preview overlay already open on its Flagged tab (new deep-link: any engagement URL can now end with ?preview=flagged or ?preview=1 to auto-open the Preview).
5. NO database migration was needed. All five signals were computable from columns that already exist (per-file review status, upload timestamps, AI flags, signature item kind). The dashboard query now reads a few more columns from the same table it already queried; still one query.

Where it lives: src/lib/dashboard/action-signals.ts (the new pure signal computation, fully unit-tested), src/lib/dashboard/worklist-select.ts (membership + sort), src/components/dashboard/needs-attention.tsx and needs-attention-row.tsx (chips), src/components/engagements/engagement-preview/engagement-preview.tsx (deep-link).

Verification: typecheck PASS, 810 tests PASS (15 new), lint 0 errors, production build PASS.

---

## Workstream D: Team page Edit firm + seat caps (DONE)

What changed, in plain English:

1. Settings > Team now has an "Edit firm" button (next to "Invite teammate") that jumps to the existing Firm settings section (Settings > Account: logo, name, brand color, client language). Owners only; staff never see it, and the underlying settings save action was already blocked server-side for staff (verified, untouched).
2. Seat caps now follow the locked plan tiers: Solo 2, Cabinet 6, Cabinet+ 15. The trial plan keeps its 5 seats. A per-firm override (seat_cap_override, which already existed in the database) still wins over the plan number when set.
3. Where the "1 of 5 seats" came from: the current firm is on the default trial plan, whose cap is 5. Trial was not changed, so the firm's effective cap is still exactly 5. NO database write or override was needed to preserve it (the decision default about setting override=5 was written for a firm with no plan; this firm has one).
4. The public pricing page also said "1 user" (Solo) and "Up to 10 users" (Cabinet), which would have contradicted the now-enforced caps. Updated to "Up to 2 users" and "Up to 6 users" in both languages. FOUNDER: this touches pricing-page copy, normally an ask-first area; the brief locked these tiers, so the displayed numbers were aligned with the enforced ones. Flag if you wanted the old copy.

Where it lives: src/lib/plans.ts (the numbers), src/components/settings/team/team-manager.tsx (the button), src/lib/db/firms.ts (type gap fixed: seat_cap_override added to the Firm type), messages/en.json + fr.json.

Verification: typecheck PASS, 810 tests PASS (two test files had locked the OLD caps and were updated to the new locked tiers), lint 0 errors, production build PASS.

---

## Decision log

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D1 | npm install before baseline (lockfile was ahead of node_modules) | main added fflate; baseline must reflect main | package-lock.json (no change by me) |
| D2 | Workstream D will NOT write a seat_cap_override for the current firm | firm is on plan='trial' whose cap stays 5; effective cap unchanged without any DB write | src/lib/plans.ts |
| D3 | Workstream E will NOT retroactively mark legacy files as duplicates | re-bucketing already-reviewed documents is a data-semantics change too risky without supervision; hash backfill + on-upload detection covers the future | src/lib/duplicates.ts |
| D4 | All-approved engagements park in Ready to review until Mark complete | explicit decision default in the brief; conservative (surfaces work) | src/lib/attention.ts isReadyToReview |
| D5 | A rejected REQUIRED item makes the engagement In progress, not Ready | the brief's In-progress definition: "only rejected files awaiting replacement" means the client owes work; the per-file review work still surfaces via Workstream C's sitting-unreviewed chip | src/lib/attention.ts itemsRequiredBlocked |
| D6 | Stuck Analyzing chips fixed in the UI only, NO migration, NO re-running of old analyses | the data is not wrong (NULL analysis is a real terminal state when the AI quota or config skipped a job); re-running analysis on old files could auto-reject and NOTIFY clients, which is banned in this run; staleness window 15 min, adjustable constant | src/components/engagements/ai-badge.tsx |
| D7 | Client pages' engagement pills also unified | the brief says the unified status applies everywhere it shows; reuses the same cached query the Overview uses, negligible cost | src/app/[locale]/(app)/clients/page.tsx, clients/[id]/page.tsx |
| D8 | Progress % formula unchanged | with the pill now reading Ready to review, "100% + Ready" is coherent; changing the formula would move numbers the founder did not ask to move | src/lib/attention.ts |
| D9 | Top-row side-by-side kicks in at 2xl (1536px), stacked below | at smaller widths the main column (after sidebar + rail) leaves too little room for two readable blocks; measured against the shell's 1600/2100 caps | src/app/[locale]/(app)/dashboard/page.tsx |
| D10 | Needs attention keeps its saved collapse preference | the brief says "opens expanded by default", which is already the default; silently deleting the founder's saved preference would be surprising | src/components/dashboard/needs-attention-collapsible.tsx (untouched) |
| D11 | Overdue and due-soon chips KEPT in Needs attention 2.0 | the brief's five signals don't list them, but removing them would HIDE work the block surfaces today; chasing a late client is accountant work too; conservative bias says keep | src/lib/dashboard/worklist-select.ts |
| D12 | No migration for Workstream C | all five signals computable from existing columns (review_status + uploaded_at + ai_rejected + ai_usability + kind); "sitting unreviewed since" IS the pending file's upload time, so no new timestamp was needed; keeps the shared prod DB untouched | src/lib/dashboard/action-signals.ts |
| D13 | "Flagged twice" interpreted as: any AI-flagged or escalated upload awaiting the accountant's call, plus outstanding auto-rejects | the file-level flags don't record strike counts; the escalation flag (ai_rejected on a still-pending file) IS the flagged-twice marker the router writes; superseded bounces excluded | src/lib/dashboard/action-signals.ts |
| D14 | Preview deep-link is ?preview=1 / ?preview=flagged on the engagement URL | smallest possible plumbing for "open the Preview where that is clearly the better landing"; only the header Preview button auto-opens | src/components/engagements/engagement-preview/engagement-preview.tsx |
| D15 | No seat_cap_override written for the current firm | the firm is on plan='trial' (cap 5, unchanged), so its effective cap is preserved with zero DB writes; the decision default's override=5 instruction was for a firm with NO plan | src/lib/plans.ts |
| D16 | Pricing page seat copy aligned to the locked tiers (Solo "Up to 2 users", Cabinet "Up to 6 users", EN + FR) | the brief locked the tiers; advertising 10 seats while enforcing 6 would mislead buyers; normally ask-first territory, so flagged loudly in the Workstream D summary | messages/en.json, messages/fr.json |
| D17 | Edit firm links to /settings?tab=account | that is where the existing firm settings section lives (the old /firm page already redirects there); no duplicated form | src/components/settings/team/team-manager.tsx |

(More decisions appended as workstreams complete.)

## Commits

- (this commit) Phase 0 findings + report skeleton.

## For the founder: check these when you're back

(filled in at the end of the run)
