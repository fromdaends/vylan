# Multi-user / firm-scoping security & correctness audit

**Date:** 2026-05-13
**Scope:** Read-only audit of the multi-user / firm-scoping infrastructure for Vylan.
**Branch audited:** `claude/distracted-kowalevski-7c2622` at HEAD `b7fb7d8`.
**Migration range:** `0001_init.sql` → `0029_ai_usability.sql` (11 migrations on disk).
**Tests:** `npm test` → `Test Files 17 passed (17) · Tests 115 passed (115)`.

> **CRITICAL FINDINGS (TL;DR):** Two RLS gaps allow an authenticated firm member
> to (1) move themselves into any other firm by direct PATCH on `users` and
> (2) self-upgrade their own firm to any paid plan via direct PATCH on `firms`.
> See Section 3 and the Verdict.

---

## Section 1 — Signup flow

### Trace

`src/app/actions/auth.ts:signupAction` → calls `supabase.auth.signUp({email, password, options:{data:{name, locale}}})` (line 115) → on success, **redirects to `/onboarding`** (line 128). It does NOT create the `users` row or `firms` row.

The `users` + `firms` rows are created inside `src/app/actions/onboarding.ts:submitStep1`:

- Line 68: `getServerSupabase()` (authed client).
- Line 69-70: `supabase.auth.getUser()` — bail if no session.
- Line 78: `getCurrentFirm()` to detect re-entry.
- Line 84: `const admin = getServiceRoleSupabase();` (bypasses RLS).
- Line 85-94: `admin.from("firms").insert({...}).select("id").single()`.
- Line 99-106: `admin.from("users").insert({ id: auth.user.id, firm_id: firm.id, ..., role: "owner", ... })`.

### 1.1 Single transaction?

**NO.** There is no transaction wrapping the three operations (auth.users via signup, firms insert, users insert). They are three separate network calls:

1. `auth.signUp` (in signupAction — minutes earlier, on a different request).
2. `admin.from("firms").insert(...)` (in submitStep1).
3. `admin.from("users").insert(...)` (in submitStep1, after firm insert succeeds).

Supabase JS client does not expose `BEGIN ... COMMIT` for multi-statement ACID across these inserts.

### 1.2 Is the new user set as `owner` of their new firm?

**YES.** `src/app/actions/onboarding.ts:104` sets `role: "owner"` explicitly on the user row insert. The `users` table also has `role user_role not null default 'staff'` (`0001_init.sql:62`), so future inserts default to staff.

### 1.3 Partial-failure modes

If `auth.signUp` succeeds but the user never reaches submitStep1 (closes the tab):
- An **`auth.users` row exists**, but no `public.users` row and no `public.firms` row.
- Next login redirects to `/onboarding` via `src/app/[locale]/(app)/layout.tsx:29` (because `!dbUser || !firm || !firm.onboarded_at`).
- The orphan auth row is harmless aside from blocking re-signup with the same email (Supabase will reject as duplicate).

If `submitStep1` creates the firm row but `users` insert fails (e.g., constraint violation, network):
- **Orphan firm row.** Re-entering submitStep1 calls `getCurrentFirm()` (line 78), which queries `users` for the caller's id → returns null → falls back into the `!existingFirm` branch and creates a **second** firm row. The first orphan remains. No cleanup logic.
- This is **not exploitable**, but it would leak phantom rows over time. There is no scheduled cleanup of firms without a users row.

If `auth.signUp` fails: nothing is created. Good.

### 1.4 Is `firm_id` set on the user row before dashboard?

**YES.** The user cannot reach the dashboard until `firms.onboarded_at IS NOT NULL` — this is set inside `submitStep3` (`actions/onboarding.ts:151`). The `(app)/layout.tsx:29` redirect to `/onboarding` enforces it on every dashboard hit. `getCurrentFirm()` is first called inside that layout (line 27), and again on every page that needs it.

**Note:** `submitStep1` is the only path that creates the `users` row. If the user reaches `submitStep2` or `submitStep3` without a `users` row (theoretical: skipping step 1 via direct URL), the wizard would crash inside `updateCurrentFirm()`. The wizard's `step` selector clamps the requested step but still renders the form for that step. **Not a security issue, but a fragility.**

### 1.5 Verdict for Section 1

- The 3-step bootstrap (auth.users → firms → users) is **not atomic**. Partial failure leaves orphans.
- The owner role IS assigned correctly at user-row creation.
- The dashboard layout's RLS-friendly redirect chain handles the "no firm yet" case correctly.

---

## Section 2 — Invite flow

### 2.1 Is there a UI to invite teammates?

**Partial / stub.** Onboarding step 3 (`src/app/[locale]/onboarding/step3-form.tsx`) has a textarea labeled `step3_emails_label`. Below it, the literal copy from `messages/en.json:130`:

> "Invites will be sent once that feature ships (coming soon)."

There is **no invite UI on the settings page, profile page, or anywhere else in the post-auth app.** I searched all `.ts`/`.tsx` files for `invite`/`invitee`/`invitation` — only matches are the onboarding stub.

### 2.2 What's the data flow?

`submitStep3` parses the email list, then `updateCurrentFirm({ invited_emails: emails, onboarded_at: new Date().toISOString() })` (`actions/onboarding.ts:148-151`). The emails are written to `firms.invited_emails` (JSONB array, added in `0004_onboarding.sql:14`). **Nothing else reads or acts on this column** — confirmed by grep:

```
src/app/actions/onboarding.ts:149   (the write site)
src/lib/db/firms.ts:17              (just a type member)
src/lib/db/firms.ts:52              (the union of patchable columns)
```

### 2.3 How does the invitee receive the invitation?

**They don't.** `src/lib/email.ts` exports `sendEmail`, `buildEngagementInviteEmail`, `buildReminderEmail`, `buildWelcomeEmail`. There is **no `buildTeamInviteEmail` and no caller that would send one**. The list of pending emails is stored and ignored.

### 2.4 When the invitee accepts, do they join the existing firm?

**Moot — there is no acceptance flow.** If an invitee tried to sign up today using `/signup`, they would:
1. Create a new auth.users row.
2. Land on `/onboarding`.
3. Step 1 creates a brand-new firm (not join the inviter's). The "invitee" would be `owner` of their own brand-new isolated firm, not staff at the inviter's firm.

The existence of `invited_emails` on a firm has zero effect on signup. There is no token, no signup-with-token route, no shared-firm bootstrap path.

### 2.5 Is the invitee's role set correctly?

**Moot — see 2.4.** If/when the invite flow is built, the existing `submitStep1` would create them as `owner` of a new firm. A separate code path will be needed to insert a `users` row with `firm_id = inviter.firm_id, role = 'staff'`.

### 2.6 Single-use? Expiring?

**Moot — there are no invite links.**

### 2.7 What if an invited email already has an account?

**Moot.** Likely future risk: if the invite flow naively reuses signup, the existing user would either get a duplicate-email signup error (Supabase blocks) or, worse, an attacker could re-claim someone else's invite. Worth thinking through before shipping.

### 2.8 Verdict for Section 2

**🚫 Not built.** The invite feature is a UI stub that captures emails into `firms.invited_emails` and never acts on them. There is no token system, no email send, no acceptance route, and no role-aware signup path. Today, the product is effectively single-user-per-firm.

---

## Section 3 — Firm scoping (RLS review)

All migrations enable RLS on every domain table. `current_firm_id()` is defined in `0001_init.sql:197-201`:

```sql
create or replace function public.current_firm_id() returns uuid
language sql stable security definer set search_path = public
as $$ select firm_id from public.users where id = auth.uid() $$;
```

This is **security-definer** — it bypasses RLS to read the caller's own firm_id from `users`. Good.

### Per-table summary

| Table | RLS enabled | Policy refs `current_firm_id()` or `auth.uid()`? | Notes |
|---|---|---|---|
| `firms` | ✅ (`0002_rls.sql:8`) | ✅ select: `id = current_firm_id()`; update: same; **insert dropped in `0009`** | ⚠ **firms_update allows ANY column** — see 3.1 |
| `users` | ✅ (`0002_rls.sql:9`) | ✅ select: `firm_id = current_firm_id()`; update: `id = auth.uid()`; **insert dropped in `0009`** | ⚠ **users_update_self allows ANY column** — see 3.2 |
| `clients` | ✅ | ✅ all: `firm_id = current_firm_id()` (both using + with check) | OK |
| `engagements` | ✅ | ✅ all: `firm_id = current_firm_id()` | OK |
| `request_items` | ✅ | ✅ all: subquery `engagements.firm_id = current_firm_id()` | OK |
| `uploaded_files` | ✅ | ✅ all: subquery via engagement | OK |
| `reminders` | ✅ | ✅ all: subquery via engagement | OK |
| `templates` | ✅ | ✅ select: `firm_id is null OR firm_id = current_firm_id()`; write: `firm_id = current_firm_id()` | OK — built-ins are shared-read only |
| `activity_log` | ✅ | ✅ select + insert: `firm_id = current_firm_id()` | OK (no update/delete policy → append-only via authed client) |
| `jobs` | ✅ (no policies) | n/a (deny-all to authenticated) | OK — service-role only |
| `feedback` (`0007`) | ✅ | ✅ select + insert: `firm_id = current_firm_id()` | OK (intentionally append-only) |
| `ai_rejection_overrides` (`0029`) | ✅ | ✅ all: subquery via `uploaded_files → engagements.firm_id` | OK |

### 3.1 ❌ CRITICAL: `firms_update` permits column-level abuse (plan escalation)

**File:** `supabase/migrations/0002_rls.sql:22-24`

```sql
create policy firms_update on firms for update
  using (id = public.current_firm_id())
  with check (id = public.current_firm_id());
```

This policy gates UPDATE by **row** (a user can only update their own firm row), but **not by column**. Any authenticated firm member can PATCH any column on their own firm row via PostgREST:

```http
PATCH /rest/v1/firms?id=eq.<their-firm-id>
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "plan": "cabinet_plus", "subscription_status": "active",
  "current_period_end": "2099-12-31T00:00:00Z",
  "trial_ends_at": "2099-12-31T00:00:00Z",
  "stripe_subscription_id": "sub_attacker" }
```

The row check passes (`id = current_firm_id()` is true for their own firm), so this write succeeds. They have **self-upgraded to the highest paid plan without paying Stripe**. They have unlocked plan limits for their firm. The next Stripe webhook would not correct this — webhooks update on Stripe events, and there's no Stripe-side event tying back to a forged update.

Even worse: a malicious member could set `stripe_customer_id = <some-other-firm's-stripe-id>`. Then when the webhook for the legitimate-paying firm next fires, `findFirmForCustomer` (`api/billing/webhook/route.ts:75-82`) would pick the attacker's row by stripe_customer_id, and **apply the legit firm's plan to the attacker** (or vice-versa). The attacker could also harvest customer IDs by enumerating; a known customer ID would also let them craft a refund / cancellation against another firm via the customer portal flow.

Also writeable through this same gap: `name`, `brand_color`, `logo_url`, `timezone`, `locale_default`, `business_hours`, `invited_emails`, `onboarded_at`, `auto_reject_unusable_docs`. The branding/settings columns are intentional (already exposed via UI), so changing them is not a privilege escalation. The **billing columns and `stripe_customer_id` are the exploitable surface**.

**No mitigation in code:** there are no triggers, no column-level GRANT/REVOKE, no `WITH CHECK` that pins billing fields.

**Server-side `updateCurrentFirm()` (`src/lib/db/firms.ts:43`) is type-restricted to a whitelist of patchable columns** (`name | locale_default | brand_color | timezone | business_hours | invited_emails | onboarded_at | auto_reject_unusable_docs`), but the type restriction lives in TypeScript only — it does **not** protect against direct PostgREST PATCH from a hostile browser.

### 3.2 ❌ CRITICAL: `users_update_self` permits firm-hopping (tenant jump)

**File:** `supabase/migrations/0019_user_profile.sql:21-25`

```sql
create policy users_update_self on users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
```

This policy gates UPDATE by **row** (user can update their own user row), but not by column. An authenticated user can PATCH their `firm_id` to any UUID via direct PostgREST:

```http
PATCH /rest/v1/users?id=eq.<their-own-uid>
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "firm_id": "<target-firm-uuid>", "role": "owner" }
```

The check `id = auth.uid()` evaluates true → the write succeeds. The user has moved themselves into the target firm. Because `current_firm_id()` reads `users.firm_id`, **every subsequent RLS check now resolves to the target firm**, granting full read/write of that firm's clients, engagements, uploaded files, reminders, templates, activity log, etc.

**How an attacker discovers target firm IDs:** Sign up two accounts → observe own `firm_id`. Try sequential or guessed UUIDs (low yield). Worse: anything that ever leaks a firm UUID — error messages, URLs that embed firm_id, log files, screenshots in public support tickets — would unlock the corresponding firm. The portal /r/ tokens don't expose firm_id, but several internal-error paths plausibly do.

**The FK constraint `users.firm_id → firms.id` only protects against pointing at nonexistent firms.** It does not prevent pointing at any *existing* firm.

**No mitigation in code:** the column write is gated only by RLS, no trigger, no column-level grant. The TypeScript-only `UserProfilePatch` type whitelists `display_name | locale | avatar_path` for the server action, but again, this does not constrain raw PostgREST PATCH.

This is a **tenant-isolation bypass** — exactly the threat RLS is supposed to prevent. It coexists with otherwise-correct firm scoping because the bypass is in the row a user is "supposed to" own.

### 3.3 Service-role usages: are they re-checking firm_id?

40 callers of `getServiceRoleSupabase()`. Reviewed each:

| Caller | Re-checks firm? | Notes |
|---|---|---|
| `actions/ai.ts:37` | n/a (job-bookkeeping update by file id; authed sanity check at line 18-24) | OK |
| `actions/onboarding.ts:84` | Inserts new firm/user — no other firm to check against | OK by design |
| `api/portal/upload/route.ts:99,189` | Token-validated via `findItemForToken`, derives `engagement.firm_id` from DB | OK |
| `api/portal/mark-na/route.ts:40` | Same pattern | OK |
| `api/portal/undo-na/route.ts:35` | Same pattern | OK |
| `api/billing/webhook/route.ts` | Looks up firm by Stripe `customer_id` (matched server-side, not from request body); see also 3.1 concern | Mostly OK — see 3.1 about `stripe_customer_id` being writeable |
| `lib/storage.ts:128,139` | No firm check — uploads use service role; storage path is built by caller and includes firmId | Depends on caller; portal/upload uses `engagement.firm_id` from DB → safe. Branding uses `firm.id` from `getCurrentFirm()` → safe. |
| `lib/reminders.ts:109` | Worker pulls firm_id from engagement row | OK |
| `lib/ai/classify.ts:234`, `lib/ai/process.ts:28` | Job worker; firm_id used only for rate-limit + activity log; derived from engagement | OK |
| `lib/db/jobs.ts:*` | Pure queue plumbing — no firm scoping by design | OK |
| `lib/db/portal.ts:*` | Token-validated entry points only | OK |
| `lib/db/uploaded-files.ts:37` | `signedDownloadUrl` for path — caller already proved firm membership to reach this code path; **path is trusted from the row, not the request** | OK |

**No backdoors found.** The service-role usages all derive firm_id from validated database rows or from the validated session — never directly from a request body field. The portal endpoints (`mark-na`, `undo-na`, `upload`) validate the magic token and use `engagement.firm_id` from the database, not from the request.

### 3.4 Storage bucket `client-uploads`

`0003_storage.sql:8` creates a private bucket with file_size_limit 25 MB and MIME allowlist. Only a SELECT policy is defined:

```sql
on storage.objects for select to authenticated
using (
  bucket_id = 'client-uploads'
  and (storage.foldername(name))[1] = 'firms'
  and (storage.foldername(name))[2]::uuid = public.current_firm_id()
);
```

**SELECT is firm-scoped via path prefix** — but since `current_firm_id()` reads `users.firm_id`, a user who exploited 3.2 to switch firms would also see the target firm's uploaded files (read), so storage is **transitively vulnerable to 3.2**.

INSERT/UPDATE/DELETE policies on `storage.objects` for this bucket are **missing**, which means the default Supabase storage deny-all applies → only service role can write. Server-side upload endpoints all use service role. Good.

### 3.5 Section 3 verdict

The RLS *structure* is correct and consistent — every domain table is enabled with a `current_firm_id()`-derived policy. The two cracks are both column-level write surfaces left ungated on policies that gate by row:

- 3.1 `firms_update` → plan escalation, billing-record tampering.
- 3.2 `users_update_self` → tenant jump (severity is "complete tenant isolation bypass" — any authenticated user can read/write any firm whose UUID they know).

Both are direct-PostgREST attacks; the server-side actions are not the vulnerable code path, but they're also not what an attacker would use.

---

## Section 4 — Permission boundaries (owner vs. staff)

The `users.role` column exists (`user_role enum ('owner', 'staff')`), but **no code in `src/` reads it for authorization**. Grep across the entire `src/` tree for `role === 'owner'` / `role === 'staff'` / `if (user.role`:

```
src/app/actions/onboarding.ts:104   role: "owner",       (setter at signup)
src/lib/db/users.ts:8               role: "owner" | "staff";   (type only)
```

That's it. Everywhere else, the only access gate is firm membership.

### 4.1 Can staff invite teammates? — moot (no invite flow), but **no role check exists if/when added**.

### 4.2 Can staff change firm settings?

**Yes** — `src/app/actions/settings.ts:updateFirmSettings` (line 29) calls `updateCurrentFirm()` directly with no role check. Same for `submitStep1/2/3` and the profile page's "Your firm" section.

### 4.3 Can staff access billing / change plan?

**Yes** — `src/app/api/billing/checkout/route.ts` checks `auth.user` (line 31) and `getCurrentFirm()` (line 34), but **no role check**. Any firm member can initiate a checkout that moves the firm onto a paid plan with their card, AND any firm member can open the customer portal (`api/billing/portal/route.ts`) which gives them cancel/refund powers over the firm's subscription.

### 4.4 Can staff delete clients or engagements?

**Yes** — `archiveClientAction`, `restoreClientAction`, `bulkCreateClients`, `commitImportAction`, `deleteDraftAction`, `cancelEngagementAction` all run with **no role gate**. A staff member can wipe out drafts and cancel engagements.

### 4.5 Can staff archive the firm or change ownership?

**🚫 Neither exists.** No archive-firm action, no transfer-ownership action, no remove-user-from-firm action.

### 4.6 Section 4 verdict

**Effectively, every firm member is an owner today.** The `role` column is set at signup but never consulted. To enforce the documented MVP target ("owner does everything; staff does everything except billing / plan / team"), every action listed above (4.2, 4.3, and any future team-management/firm-archive action) needs an explicit role check before mutating.

---

## Section 5 — Edge cases

### 5.1 Solo founder

✅ **Works.** Single-user-per-firm is the default path. signup → onboarding → dashboard. No invite flow needed. All actions assume single-user.

### 5.2 Multi-user: owner + 1 staff, simultaneous login

Assuming a staff `users` row is somehow created (today, only via direct DB write or expanded service-role helper):
- `current_firm_id()` returns the same firm UUID for both.
- `clients_all`, `engagements_all`, etc. allow both users full read/write of the same rows.
- ✅ Both see the same client list, the same engagements.
- ⚠ Both can mutate without role gating (see Section 4).

### 5.3 Direct URL attack (logged-out user OR staff at firm A → URL of firm B's client)

- **Logged-out user hitting `/clients/{firm-B-uuid}`:** middleware (`src/proxy.ts` + `src/lib/supabase/middleware.ts`) doesn't redirect, but the `(app)/layout.tsx` server component checks `auth.user` (line 21-24) and redirects to `/login`. ✅ Blocked.
- **Firm-A staff hitting `/clients/{firm-B-client-uuid}`:** `getClient(id)` (`lib/db/clients.ts:59`) queries `clients` via authed client. RLS policy `clients_all` requires `firm_id = current_firm_id()`. For firm-A staff, this evaluates to firm-A's UUID, which won't match firm-B's row → query returns `null` → page renders `notFound()`. ✅ Blocked.
- **BUT:** this blocking depends on the attacker not having executed 3.2 first. If they have, all bets are off.

### 5.4 Direct API call attack with forged `firm_id`

- POST-style server actions for clients/engagements/etc. do **not** accept a client-supplied `firm_id`; the server derives it from `currentFirmId()` / `getCurrentFirm()`. ✅ Safe at the action layer.
- Direct PostgREST POST/PATCH with a forged firm_id is still attempted in 3.1 and 3.2.
- For domain tables (`clients`, `engagements`, etc.), the `with check (firm_id = current_firm_id())` clause **does** block direct inserts/updates that try to set firm_id to another firm. ✅
- For `users` and `firms`, the `with check` is keyed on `id = auth.uid()` and `id = current_firm_id()` respectively, neither of which constrains the *new* firm_id or plan value being written to columns. ❌ (see 3.1 and 3.2).

### 5.5 Logout / re-login session

`getCurrentFirm()` re-reads `users.firm_id` on every server request (`src/lib/db/firms.ts:28-33`). No cached value, no JWT claim with firm_id baked in. So a re-login re-derives firm_id fresh. ✅ Correct.

Note: this also means an attacker who exploits 3.2 mid-session sees the new firm immediately on next request — there's no JWT-cache barrier.

---

## Section 6 — Verdict

### ✅ Works correctly

- `current_firm_id()` is defined as `security definer` and reads from `users.firm_id`, returning the correct value for each authenticated caller.
- Every domain table (`clients`, `engagements`, `request_items`, `uploaded_files`, `reminders`, `templates`, `activity_log`, `feedback`, `ai_rejection_overrides`) has RLS enabled with a firm-scoped `using` and `with check` clause that includes the firm_id (directly or via subquery).
- The `jobs` table has RLS enabled with no policy — correctly deny-all to authenticated.
- Service-role usages all derive firm_id server-side from validated DB rows; no service-role caller blindly trusts a client-supplied firm_id.
- The unauthenticated portal flow validates the magic token shape, looks up the engagement row, checks expiry/status, and derives the firm_id from the engagement — no leak into other firms.
- The `(app)/layout.tsx` redirect chain enforces "must have an authed session AND a users row AND an onboarded firm" before any dashboard route renders.
- `getCurrentFirm()` re-reads on every request (no stale session cache).
- Migration 0009 correctly dropped the permissive `firms_insert` and `users_insert_self` policies — only server-side service-role code can now create firms and users.
- 115/115 tests pass.

### 🟡 Fragile / missing-small-piece

- No transaction wrapping the 3-step bootstrap (auth.signUp → firms insert → users insert) in `submitStep1`. Partial failure leaves orphan firm rows. No scheduled cleanup. Low impact today, but it will compound.
- No cleanup for orphan storage objects when a request_item or engagement is deleted (acknowledged TODO in `lib/db/request-items.ts:132`).
- The `firms.invited_emails` column stores email lists that nothing consumes — drift between schema and code.
- `signupAction` doesn't surface a "check your email to confirm" state, suggesting email confirmation is OFF in the Supabase config. If/when it's turned ON, the flow needs UI for "we sent you a confirmation email."
- The wizard's `step` query-string is clamped to 1..3 but doesn't enforce that step 1 was completed before showing step 2/3 — no security issue, but step 2 would crash on an empty `firms` row.

### ❌ Broken / insecure

#### Finding A — Plan escalation via direct `firms` PATCH (HIGH severity)

`firms_update` policy in `supabase/migrations/0002_rls.sql:22-24` lets any authenticated firm member directly PATCH the `firms` row, including `plan`, `subscription_status`, `current_period_end`, `trial_ends_at`, `stripe_subscription_id`, and `stripe_customer_id`. Direct PostgREST PATCH bypasses the TypeScript whitelist in `updateCurrentFirm`. Exploitation grants unlimited plan tier without paying Stripe and lets the attacker corrupt the Stripe-webhook customer-lookup path.

#### Finding B — Tenant isolation bypass via direct `users` PATCH (CRITICAL severity)

`users_update_self` policy in `supabase/migrations/0019_user_profile.sql:21-25` lets any authenticated user PATCH their own users row's `firm_id` and `role` columns. Direct PostgREST PATCH bypasses the TypeScript whitelist in `updateUserProfile`. Exploitation lets a hostile authenticated user move into any firm whose UUID they obtain — gaining full read/write access (clients, engagements, files, billing details, etc.) at that firm.

The combined effect of Finding B and Finding A: an attacker can target a specific firm by UUID, jump into it, and (if not already on a paid plan there) self-upgrade. Their actions there appear in activity_log attributed to their `auth.uid()`, which would only be useful for forensic post-mortem.

#### Finding C — No role-based authorization (MEDIUM severity)

The `users.role` column is set at signup but **never read** anywhere in `src/`. As soon as a multi-user firm exists, every staff member has full powers including billing (start new subscription, open customer portal which can cancel + refund), client deletion, engagement cancellation, and firm settings. This is not exploitable today (because no invite flow exists), but it's a blocker for shipping multi-user.

### 🚫 Not built — but probably should be before public multi-user launch

- **Invite flow.** No token, no email, no acceptance route, no staff-role signup path. Today, two people from the same firm cannot share data unless an engineer manually inserts a users row.
- **Team management UI** (list members, remove a member, change role).
- **Transfer ownership** (only the current owner can do this; needed before a founder can leave).
- **Archive / delete firm** (currently no off-ramp short of direct DB deletes).
- **Email-already-has-an-account collision handling** for the eventual invite flow (user accepting an invite for an email already tied to a different firm).
- **Column-level GRANT/REVOKE on `users` and `firms`** (or a BEFORE-UPDATE trigger) to close Findings A and B. Without it, RLS-by-row is insufficient.

---

## Suggested remediation outline (NOT applied — read-only audit)

The fixes for A and B both follow the same pattern: **constrain which columns the policy permits, not just which rows.**

Two viable approaches:

**Option 1 — Column-level grants (clean, declarative):**

```sql
revoke update on public.users from authenticated;
grant update (display_name, avatar_path, locale) on public.users to authenticated;

revoke update on public.firms from authenticated;
grant update (name, brand_color, logo_url, timezone, locale_default,
              business_hours, auto_reject_unusable_docs)
  on public.firms to authenticated;
```

This keeps the RLS row-scope and adds a column whitelist at the SQL grant level.

**Option 2 — BEFORE UPDATE trigger that pins immutable columns:**

```sql
create function public.users_pin_firm_id_role() returns trigger
language plpgsql as $$
begin
  if new.firm_id <> old.firm_id then
    raise exception 'users.firm_id is immutable from the user role';
  end if;
  if new.role <> old.role then
    raise exception 'users.role is immutable from the user role';
  end if;
  return new;
end $$ security definer;

create trigger users_pin before update on public.users
  for each row when (current_setting('request.jwt.claim.role', true) = 'authenticated')
  execute function public.users_pin_firm_id_role();
```

Similar trigger needed on `firms` to pin `plan`, `stripe_*`, `subscription_status`, `current_period_end`, `trial_ends_at`.

Option 1 is simpler and reasons about a static allowlist; option 2 is more flexible but adds a function and a trigger to maintain. Either fixes both findings.

For Finding C (no role checks): introduce a small `requireRole(role: 'owner')` helper that wraps the relevant server actions (`updateFirmSettings`, billing checkout/portal, future invite actions) and short-circuits with a 403-equivalent if the caller is not owner. The check is cheap because every action already pulls `getCurrentUser()`.

---

## Appendix — file references

- `supabase/migrations/0001_init.sql` (schema + `current_firm_id()` helper).
- `supabase/migrations/0002_rls.sql` (initial policies; **firms_update at line 22-24**, users_select at 31-32).
- `supabase/migrations/0009_lock_down_firms_users_insert.sql` (dropped permissive inserts).
- `supabase/migrations/0019_user_profile.sql` (**users_update_self at line 21-25**, added avatar_path + display_name).
- `supabase/migrations/0029_ai_usability.sql` (ai_rejection_overrides + auto-reject opt-in).
- `src/app/actions/auth.ts` (signupAction at line 98-129).
- `src/app/actions/onboarding.ts` (submitStep1 at 58-119, submitStep3 at 137-156).
- `src/app/actions/settings.ts` (updateFirmSettings at 29-48).
- `src/app/actions/profile.ts` (changePasswordAction, updateLocaleAction, updateAvatarAction).
- `src/lib/supabase/server.ts` (getServerSupabase, getServiceRoleSupabase).
- `src/lib/db/firms.ts` (getCurrentFirm, updateCurrentFirm whitelist).
- `src/lib/db/users.ts` (getCurrentUser, updateUserProfile whitelist).
- `src/app/[locale]/(app)/layout.tsx` (auth + firm redirect chain at 12-31).
- `src/app/[locale]/onboarding/step3-form.tsx` (the "invites coming soon" stub at line 54).
- `src/app/api/billing/checkout/route.ts`, `src/app/api/billing/portal/route.ts`, `src/app/api/billing/webhook/route.ts` (billing surface — no role check).
- `src/app/api/portal/upload/route.ts`, `mark-na/route.ts`, `undo-na/route.ts` (token-validated client portal).
- `src/proxy.ts` (intl + Supabase session refresh middleware).
