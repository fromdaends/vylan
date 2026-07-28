# Notifications tab — Phase 0 audit

Read-only inventory of what already exists, run before any Notifications code is
written. Produced 2026-07-28 (Zach's PC / device 2). **No code or migration was
written for this phase.**

The headline: **this is not greenfield.** There is already a working in-app
notification feed with 14 event kinds, a bell, a `/notifications` page, per-viewer
scoping, and an i18n namespace called `Notifications`. There are also 3 firm-facing
emails that fire unconditionally today. The spec should extend that system, not
sit beside it.

---

## 1. What already fires today

### 1a. Firm-facing (in scope — these are what "Notifications" means)

| Trigger event | Who receives it | Channel | Can they turn it off? | Code |
|---|---|---|---|---|
| Client returns a signed copy of a signature item | **One** person: the engagement's assignee, else the firm owner | Email | **No** | `src/lib/portal/ingest-upload.ts:298` → `buildSignedCopyReturnedEmail` |
| Client replies in an engagement message thread | **One** person: assignee, else owner. Debounced 5 min, skipped if already read | Email | **No** | `src/lib/client-messages-notify.ts:267` → `buildFirmMessageEmail` |
| Engagement assigned/reassigned to a teammate | The new assignee. Delayed 2 h, skipped if they've been active since | Email | **Yes** — `firms.notify_on_assignment`, firm-level, owner-set, Team tab | `src/lib/team/assignment-notify.ts:128` |
| Engagement assigned/reassigned to a teammate | The new assignee | In-app | No | `listHomeNotifications` kind `engagement_assigned` |
| Teammate @mentioned in a file comment | The mentioned users only | In-app | No | kind `comment_mention`, from `file_comment_mention` activity |
| AI flagged / auto-rejected / escalated a document | Owner firm-wide; staff only on their engagements | In-app | No | kinds `ai_quality_flagged`, `ai_auto_rejected`, `ai_escalated_to_accountant` |
| Client uploaded a document | same scoping | In-app | No | kind `document_uploaded` |
| Client uploaded everything required | same scoping | In-app | No | kind `ready_to_review` |
| Client returned a signed copy | same scoping | In-app | No | kind `signed_copy_uploaded` |
| Client signed via embedded e-signature | same scoping | In-app | No | kind `client_signed` |
| Engagement past its due date | same scoping | In-app | No | kind `overdue` |
| Client paid | same scoping | In-app | No | kind `client_paid` |
| Payment failed | same scoping | In-app | No | kind `payment_failed` |
| Engagement marked complete | same scoping | In-app | No | kind `engagement_completed` |
| Client wrote a message | same scoping | In-app | No | kind `client_message` |
| Teammate invited to the firm | The invitee | Email | No (transactional) | `src/app/actions/team.ts:165,271` |
| Signup — confirm email, welcome | The new owner | Email | No (transactional) | `src/lib/welcome.ts`, `src/app/actions/auth.ts` |

### 1b. Client-facing (out of scope — Automation owns, or transactional)

Engagement invite, signature request, payment request, invoice, the 4-tone reminder
ladder, and the "please re-send that document" retry email. All in `src/lib/email.ts`,
all triggered from `reminders.ts`, `invoices/`, `notify-retry.ts`, `engagements.ts`,
`signatures.ts`, `recurring/spawn.ts`.

### 1c. Vylan-internal (out of scope entirely)

`src/lib/demo-notify.ts` and `src/app/actions/feedback.ts` email
`FOUNDER_NOTIFY_EMAIL` about demo leads and product feedback. Nothing to do with a
customer firm's notification preferences.

### 1d. The infrastructure that already exists

- **One sender.** `sendEmail()` in `src/lib/email.ts` wraps Resend. If
  `RESEND_API_KEY` is unset it is a no-op that logs a warning — so nothing here
  proves email is actually on in production.
- **12 templates**, all hand-written HTML strings inside that same 1,221-line file.
  No React Email, no Resend-hosted templates. **All already bilingual EN/FR**, and
  client-facing ones already take the firm logo + brand colour.
- **A deferred job queue already exists.** `jobs` table: `kind`, `payload`,
  `run_after`, `attempts`, `status`, with backoff and `cancelPendingJobs`. Drained
  by `/api/cron/process-jobs` every 2 minutes. Existing kinds include
  `notify_client_retry`, `notify_client_messages`, `notify_firm_messages`,
  `notify_assignment`.
- **4 crons** in `vercel.json`: `process-jobs` (2 min), `demo-leads` (5 min),
  `purge-deleted-engagements` (daily 04:00), `spawn-recurrences` (hourly).
- **`activity_log`** is the event backbone: `firm_id`, `engagement_id`, `actor_type`,
  `actor_id`, `action`, `metadata` jsonb, `created_at`, indexed on
  `(engagement_id, created_at desc)` and `(firm_id, created_at desc)`. ~26 action
  strings in use.
- **The in-app feed.** `src/lib/home/notifications.ts` — `listHomeNotifications()`
  aggregates the activity log + live engagement state into 14 notification kinds.
  It is **derived, not stored**. Per-viewer scoping is already implemented
  (`filterNotificationsForViewer`: owner sees firm-wide, staff see only engagements
  assigned to them, with `comment_mention` and `engagement_assigned` bypassing that
  because they're personally targeted). Deduped per (kind, destination). 14-day
  window. **The file carries an explicit `TODO(notifications-table)` saying that
  when a real notifications table ships, the body of this one function is what gets
  swapped — callers don't change.** That is exactly the seam this project should use.
- **The bell.** `src/components/inbox/whats-new-bell.tsx` — popover, count badge.
  Rendered **only on the dashboard page**, not in a global top bar. Its own comment:
  "There is no read/unread tracking — the badge is the recent-event count."
- **`/notifications` page** already exists — 50 rows, same aggregation, no
  pagination, no read/unread filter.
- **`while-you-were-away.tsx`** — a dismissible dashboard banner showing what changed
  since you last looked, using a **localStorage** per-device timestamp. This is the
  closest thing to read-state today.
- **i18n namespace `Notifications` already exists** in `messages/en.json` and
  `messages/fr.json` with `title`, `subtitle`, `empty`, `empty_hint`, `reply`, and a
  `kind_*` key for all 14 kinds.

---

## 2. Reconciliation against the proposed event catalog

`already exists` = fires today on both intended channels · `partially exists` = the
signal exists, usually in-app only · `does not exist` = nothing today.

### Documents

| key | status | notes |
|---|---|---|
| `document.uploaded` | **partially** | In-app kind `document_uploaded`. One row per engagement at its newest upload — bundling is already solved here, differently. No email. |
| `document.request_complete` | **partially** | In-app kind `ready_to_review`. No email. |
| `document.needs_review` | **partially** | Three existing in-app kinds map here: `ai_quality_flagged`, `ai_auto_rejected`, `ai_escalated_to_accountant`. Collapsing 3 into 1 toggle loses detail the founder deliberately built (the 5-strike escalation chip). Recommend keeping them as 3 separate catalog rows. No email. |
| `document.replaced_after_rejection` | **does not exist** | |
| `document.request_overdue` | **partially** | In-app kind `overdue`, but it's **engagement-level** (`due_date` passed), not per-request-item. Name is misleading. No email. |

### Engagements

| key | status | notes |
|---|---|---|
| `engagement.assigned_to_you` | **already exists** | In-app instantly + delayed 2 h email. Has a firm-level off switch today. See risk #1. |
| `engagement.stage_changed` | **does not exist** | Stage machinery exists (`src/lib/engagements/stage-sync.ts`), no notification. |
| `engagement.stalled` | **partially** | `computeAttention` already computes a `stale` reason — it just isn't pushed into the feed. Cheap to add. |
| `engagement.due_soon` | **partially** | Same: `computeAttention` already computes `due_soon`, not surfaced. Cheap to add. |
| `engagement.completed` | **partially** | In-app kind `engagement_completed`. No email. |

### Signatures

| key | status | notes |
|---|---|---|
| `signature.signer_completed` | **partially** | Vylan is **single-signer**. This and the next row are the same event here. In-app kinds `client_signed` (embedded SignWell) and `signed_copy_uploaded` (client uploads a signed PDF back). No email to the firm for the embedded path; the upload path **does** email (see risk #2). |
| `signature.all_signers_complete` | **partially** | Same event as above until multi-signer ships. Recommend one row, not two. |
| `signature.declined` | **does not exist** | The SignWell webhook handles `document_declined` and only writes a status. Nobody is told. |
| `signature.expiring_soon` | **does not exist** | Webhook handles `document_expired` after the fact. No "expiring soon" concept and no scheduled check. |

### Payments

| key | status | notes |
|---|---|---|
| `payment.received` | **partially** | In-app kind `client_paid`. No email. |
| `payment.failed` | **partially** | In-app kind `payment_failed`. No email. |
| `invoice.overdue` | **does not exist** | There is **no invoice dunning of any kind** today. This needs a scheduled check, not just an emitter call. |
| `payout.deposited` | **does not exist** | Stripe Connect payouts aren't tracked. Needs a new webhook event (`payout.paid`) on the Connect endpoint. |

### Messages

| key | status | notes |
|---|---|---|
| `message.client_replied` | **already exists** | In-app + email, 5-min debounce. See risk #3. |
| `message.unanswered` | **does not exist** | |
| `message.internal_mention` | **partially** | In-app kind `comment_mention` for **file comments**. No email. Note: team chat (`team_messages`, migration 0870) is a separate system with **no mention support at all** — so "internal mention" today means file comments only. |

### Clients

| key | status | notes |
|---|---|---|
| `client.invite_accepted` | **name mismatch** | Clients have no accounts — the portal is a magic link. `invite_accepted` in the activity log is a **teammate** accepting a firm invite, which is `team.member_joined` below. The nearest real client signal is `client_viewed_portal`. Recommend renaming to `client.portal_first_opened`. |
| `client.invite_stale` | **does not exist** | Would mean "magic link sent, never opened". The data is there (`client_viewed_portal` activity); the check isn't. |
| `client.details_updated` | **does not exist** | |

### Firm & system

| key | status | notes |
|---|---|---|
| `team.member_joined` | **partially** | `invite_accepted` activity row exists. Not surfaced, no email. |
| `team.role_changed` | **does not exist** | |
| `integration.sync_failed` | **does not exist** | `sync_quickbooks` / `sync_xero` jobs fail silently into `jobs.last_error`. Nobody is told. This is arguably the highest-value new event in the list. |
| `integration.disconnected` | **does not exist** | `account.application.deauthorized` is handled on the Connect webhook, but only writes state. |
| `billing.payment_failed` | **does not exist** | The Stripe billing webhook handles `checkout.session.completed`, subscription created/updated/deleted, and `invoice.paid` — **there is no `invoice.payment_failed` case at all.** Needs a new webhook branch, not just an emitter call. |
| `billing.renewal_upcoming` | **does not exist** | `firms.current_period_end` exists, so the data is there. Needs a scheduled check. |
| `security.new_device_login` | **does not exist** | No device or session tracking anywhere. MFA exists; login events are not recorded (the audit log records `logout`, not login). This is the **largest hidden build** in the catalog — it needs device fingerprinting, a known-devices table, and a decision about what counts as "new". |
| `digest.weekly_summary` | **does not exist** | Closest analogue is `while-you-were-away`, which is in-app and localStorage-based. |

**Totals: 2 already exist, 15 partially exist, 15 do not exist.** Roughly half the
catalog is new event plumbing (webhooks, scheduled checks, device tracking) rather
than notification wiring — that half will dominate the schedule, not the settings UI.

**How the "partially exists" ones get routed through the new emitter:** they are all
derived inside `listHomeNotifications`, not written anywhere. Each one has to move
from "recomputed on every page load" to "a row written at the moment it happens".
That means finding the write path for each (upload handler, webhook, activity-log
call site) and adding a `notify()` call there. The `TODO(notifications-table)` seam
means the read side is a single-file swap; the write side is ~15 separate call sites.

---

## 3. Behaviour-change risk list

These fire unconditionally today. Giving each an off switch is a real behaviour
change, and a firm that never knew the email was optional could silently lose it.

**Risk 1 — `engagement.assigned_to_you`.** Already has a switch, but at the **wrong
level**: `firms.notify_on_assignment` is firm-wide and owner-set. The spec makes it
per-user. Two firms' worth of settings then disagree. **Recommendation:** keep the
firm-level flag as a hard master (owner can kill it for everyone), and let per-user
prefs only narrow it further. Migrate the existing value as each user's default so
nobody's behaviour changes on deploy. Do not silently drop the firm flag.

**Risk 2 — signed copy returned → accountant email.** Unconditional today, and it is
the *only* signal for a legally meaningful client action. **Recommendation:** default
email ON, and label it explicitly ("A client sent back a signed document"). Do not
lock it, but this is the one most worth a confirmation prompt when a user turns it off.

**Risk 3 — client replied → accountant email.** Unconditional today. This is a client
waiting for an answer; a silently-off switch means a client is ignored. **Recommendation:**
default ON with clear labelling. Also note it is **debounced 5 minutes** today —
that debounce must survive the new bundling rule, or firms get more email than before,
not less.

**Risk 4 — the spec's own bundling window is a regression for documents.** Today,
`document_uploaded` produces **one row per engagement**, always, regardless of time.
The spec's 10-minute unread-bundling window is *narrower*: a client uploading over an
hour would produce several notifications where today they produce one. **Recommendation:**
bundle documents per (user, event, engagement) with no time window while unread,
matching current behaviour, rather than a 10-minute cutoff.

**Risk 5 — turning email off for the whole app.** The proposed `email_enabled` master
kill switch sits on a per-user row. Three of the emails above currently resolve to
"the assignee, **else the firm owner**". If the owner switches email off globally,
every fallback recipient path goes dark at once. **Recommendation:** the fallback-to-owner
path should ignore the personal kill switch for the 3 existing unconditional emails,
or the resolver should pick the next available recipient rather than a silent drop.

**Risk 6 — scope `assigned_only` deletes owner visibility.** Today, staff already only
see their own engagements and **owners always see everything**. The spec lets an owner
set `assigned_only`, which would hide firm-wide activity from the only person who can
act on it. **Recommendation:** offer the scope selector to staff; for owners, default
to `all_firm` and warn on change.

**Recommend locked ON (not disableable), matching the spec's `can_disable: false`:**
`billing.payment_failed`, `security.new_device_login`, `integration.sync_failed`,
`integration.disconnected`, `team.role_changed`. I'd add **`signature.declined`** to
that list — a declined signature is a dead engagement and there is no other signal.

---

## 4. Overlap with Automation

The Automation tab (owner-only) currently owns exactly two things:

1. **`ReminderAutomationDefaults`** — the firm-wide default 4-step client reminder
   ladder (gentle → firm → deadline → overdue), each step with timing, day offset,
   repeat count, an SMS toggle, and custom subject/message. Saved via
   `POST /api/firm/reminder-defaults` into `firms.default_reminder_settings`.
2. **`PaymentsInvoiceDefaults`** — invoice auto-send mode and delay days.

**Nothing in the proposed catalog belongs to Automation**, and nothing in Automation
should move. The client-facing chase cadence is fully Automation's, and the
Notifications tab's read-only pointer to it is the right call.

Two items in the catalog are **client-facing, not firm-facing**, and should be
double-checked before building:
- `document.request_overdue` — if this means "chase the client", it's Automation's
  `overdue` reminder tone, which already exists. As a firm-facing "this engagement is
  late, look at it", it's fine.
- `client.invite_stale` — "the client never opened the link" is one step from "chase
  them again", which is Automation. Keep it strictly informational.

---

## 5. Schema conflicts

**No table-name collisions.** None of `notifications`, `notification_preferences`,
`notification_settings`, `notification_mutes`, `notification_events`,
`notification_email_queue` exist. The 45 existing tables are listed in the appendix.

**But there are five design collisions worth deciding before writing SQL:**

1. **`notification_email_queue` duplicates the `jobs` table.** `jobs` already has
   `run_after`, retry/backoff, status, and cancel-pending, and is already drained
   every 2 minutes by an existing cron. A new queue table plus a new cron is a second
   scheduler doing the same job. **Recommendation:** use a `send_notification_email`
   job kind. Saves a table, a cron, a `vercel.json` change, and a `CRON_SECRET`
   dependency.

2. **`notification_settings.timezone` vs `firms.timezone`.** `firms.timezone` already
   exists (default `America/Toronto`). Per-user timezone is a genuine addition — just
   default it from the firm's value rather than a hardcoded string, or a firm outside
   Eastern gets the wrong quiet hours for every new user.

3. **`firms.notify_on_assignment` vs the new per-event prefs.** Direct functional
   overlap. See risk 1.

4. **`firms.business_hours`** (jsonb, added migration 0004) sounds like quiet hours
   but is **not** — it's a vestigial bag whose only live use is stashing a
   reminder-settings fallback. Don't reuse it, and don't assume quiet hours exist.

5. **The `Notifications` i18n namespace is already occupied** with 14 `kind_*` keys
   plus title/subtitle/empty. New settings strings must be **added** to it (the repo
   rule is add-only, never rename), and the existing `kind_*` keys should be reused as
   the catalog labels rather than writing a second set of names for the same events.

**Migration numbering:** highest on main is `0910_filed_documents_removed.sql`, so the
first Notifications migration is **`0920`** per the +10 buffer rule.

---

## 6. Things in the spec that the codebase contradicts

These aren't schema conflicts, they're plan-vs-reality gaps. Flagging all of them now
rather than discovering them at build time.

1. **There is no Supabase realtime in this codebase.** `src/components/team/team-chat.tsx`
   states it outright: "no realtime infra in this codebase". Messaging, the inbox, and
   upload status all **poll** (4 s / 10 s intervals). Part 4's "Supabase realtime
   subscription on the `notifications` table" would be the first realtime feature in
   the app — new infra, new RLS surface, new connection budget. **Recommendation:**
   poll the unread count on the same cadence as the existing inbox, and treat realtime
   as a separate later decision.

2. **Settings has 8 tabs, not 7 — the spec missed `Team`.** Actual order:
   Account, Security, General, **Team**, Payments, Automation, Integrations, Documents.
   "Between General and Payments" is ambiguous; needs a call on which side of Team.

3. **Settings is not routed per tab.** It is one client component
   (`settings-form.tsx`, 1,118 lines) with in-page tab state and a `?tab=` deep link.
   `/settings/notifications` as a route does not exist as a pattern — the equivalent is
   `/settings?tab=notifications`. (`/settings/team` and `/settings/audit` are separate
   *pages*, not tabs.)

4. **"Single Save button at the bottom, like the rest of Settings" is backwards.** The
   rest of Settings saves **per section** — `ReminderAutomationDefaults` has its own
   Save posting to its own endpoint, as do the payments sections. A single Save for the
   whole Notifications tab would be the odd one out, not the consistent one. Worth
   deciding deliberately; per-section save is what matches.

5. **The bell is dashboard-only.** Moving it to the global top bar means touching
   `app-shell.tsx`, which is shared with the mobile tab bar and the chat launcher —
   both of which have been edited by other sessions in the last two days.

6. **`security.new_device_login` has no foundation.** No login events, no session or
   device records. It is the single largest hidden build in the catalog and is marked
   `can_disable: false`, i.e. it can't be quietly dropped later.

7. **`digest.weekly_summary` + hourly/daily digests need a cron that runs on time.**
   Note from a prior session: **`CRON_SECRET` may be unset in production**, which would
   make every cron 401. That should be verified before digests are promised, since a
   digest that silently never sends is worse than instant email.

8. **Every email currently sends to one resolved person** (assignee, else owner). The
   spec's emitter fans out to *all* firm users. For a 1-person firm nothing changes;
   for a 5-person firm the same event goes from 1 email to up to 5. Worth being
   deliberate about, especially for `document.uploaded`.

---

## 7. Recommended changes to the plan

1. **Extend `listHomeNotifications`, don't build beside it.** Use the seam its own TODO
   describes: keep the function signature, swap the body to read the new table, backfill
   nothing. The bell, `/notifications`, and `while-you-were-away` then all work unchanged.
2. **Reuse the `jobs` queue** instead of `notification_email_queue`.
3. **Reuse the existing 14 `kind_*` i18n keys** as catalog labels; add only what's new.
4. **Cut the catalog for v1** to what has a real trigger today, and phase the rest.
   Suggested v1: the 17 events marked *already/partially exists* plus
   `integration.sync_failed`, `integration.disconnected`, `signature.declined`, and
   `billing.payment_failed`. Defer `security.new_device_login`, `payout.deposited`,
   `invoice.overdue`, `billing.renewal_upcoming`, and the digest until their underlying
   events exist.
5. **Decide per-section vs single Save** before the UI phase.
6. **Poll, don't realtime**, for v1.

---

## Appendix — existing tables (45)

`activity_log`, `ai_rejection_overrides`, `ai_usage_monthly`, `chat_conversations`,
`chat_messages`, `chat_pending_actions`, `client_import_sessions`,
`client_message_threads`, `client_messages`, `clients`, `demo_requests`, `engagements`,
`feedback`, `file_comments`, `filed_documents`, `filing_runs`, `final_documents`,
`firm_filing_settings`, `firm_invites`, `firm_invoice_settings`, `firms`, `jobs`,
`payment_requests`, `quickbooks_accounts`, `quickbooks_connections`,
`quickbooks_customers`, `quickbooks_items`, `quickbooks_learned_mappings`,
`quickbooks_tax_codes`, `quickbooks_transaction_suggestions`, `quickbooks_vendors`,
`recurring_occurrences`, `recurring_series`, `reminders`, `request_items`,
`signature_requests`, `storage_connections`, `team_message_reads`, `team_messages`,
`templates`, `uploaded_files`, `user_mfa_recovery_codes`, `users`, `xero_accounts`,
`xero_connections`, `xero_contacts`, `xero_items`, `xero_tax_rates`.
