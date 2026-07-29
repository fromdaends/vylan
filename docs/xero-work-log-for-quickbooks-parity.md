# Xero work log — what to replicate for QuickBooks

Running record of everything built on the Xero side (2026-07-28), so the
QuickBooks equivalents can be done deliberately rather than rediscovered.

**Nothing here has been built for QuickBooks yet — by the founder's instruction,
QuickBooks starts only once Xero is 100% done.** Keep appending as Xero work
lands.

Each item says what changed, whether QuickBooks needs the same thing, and what
is genuinely different about QuickBooks (several are NOT a straight copy).

---

## 1. Learn-from-corrections was dead — FIXED (provider-neutral, already covers QuickBooks)

**Shipped:** `d3e7f68`, `759846a`, plus approval-teaches.

The single writer (`/api/quickbooks/suggestions/[fileId]/resolve`) called
`recordLearnedMapping` without `clientId`, so every remembered pick landed in
the firm-level `client_id IS NULL` namespace while every reader filters
`.eq("client_id", <uuid>)`. Write succeeded, read returned zero rows, and zero
rows is indistinguishable from "nothing learned yet".

**QuickBooks status: ALREADY FIXED.** This code is shared — one resolve route,
one matcher, one learned-mappings table. Nothing to redo.

Also fixed in the same area, both shared:
- Split lines taught the AI's own guesses back to itself (the UI seeds every
  line from the AI match and posts the full map when one line changes).
- Approving a draft now teaches (`learnedWritesFromApproval`), so memory builds
  from the FIRST document rather than only from mistakes.

**Regression guards added:** `src/lib/db/quickbooks-learned.test.ts` (round-trips
a real write into a real read) and
`src/app/api/quickbooks/suggestions/[fileId]/learn-wiring.test.ts` (drives the
real route handlers). Both verified to FAIL when the bug is reintroduced.

---

## 2. Publish status — Draft / Awaiting approval / Awaiting payment

**Shipped:** PR #969. Migration 0970 (`default_publish_status` on
`xero_connections`, `posted_status` on `quickbooks_transaction_suggestions`).

Xero's `SUBMITTED` = "Awaiting approval", which firms running ApprovalMax need.
Per-document pick → per-client remembered default → `AUTHORISED`.

**QuickBooks equivalent: PARTIAL, and NOT a copy.** QuickBooks has no
three-state equivalent on a Bill. It does have:
- Bills: no draft/approval state at all — a Bill is created or it isn't.
- Invoices: no "awaiting approval" either.
So there is likely **nothing to build here for QuickBooks**. Confirm against
Intuit's docs before assuming; do not invent a fake status.

**The `posted_status` column IS shared** and QuickBooks writes null to it, which
is correct.

**Trap worth remembering (Xero-specific):** undo unconditionally sent `VOIDED`,
but Xero rejects that on a DRAFT/SUBMITTED invoice (legal move is `DELETED`).
QuickBooks undo has its own separate delete/void semantics — re-check them
rather than assuming they match.

**Shared hardening that helps QuickBooks too:** `getDraftForFile`'s readiness
flags now ask whether the tier landed on actually selected the column, instead
of `tier <= 3` / `<= 2` / `<= 1`. Every new column at the top used to shift all
three thresholds silently.

---

## 3. Reference fallback — every posted document traces back

**Shipped:** PR #969. `xeroPostingReference()`, bills only in v1.

A document with no invoice number posted with no Reference at all.

**QuickBooks equivalent: DO NOT COPY DIRECTLY — different field, real risk.**
- The Xero function writes to `Reference` (255 chars).
- The QuickBooks analogue is `DocNumber`, capped at **21 characters**, and
  QuickBooks **enforces uniqueness on `DocNumber`** when "Custom transaction
  numbers" is enabled. Auto-filling it would start generating duplicate-document
  -number faults on a path that works today.
- **The correct QuickBooks field is `PrivateNote`**, which is free-text and
  unconstrained. That is a separate change with a separate blast radius.
- Keep `postingReference()` (the shared 21-char helper) exactly as it is.

**Also Xero-specific:** the fallback is bills-only because Xero's bank
reconciliation "Find & Match" reads `Reference`. Check whether QuickBooks' bank
matching reads `PrivateNote` before widening.

---

## 4. Sales tax direction — stop suggesting a purchases rate on a sale

**Shipped:** PR #972. Migration 0980 (`can_apply_to_revenue` /
`can_apply_to_expenses` on `xero_tax_rates`).

The matcher picked by name similarity with no idea whether the document was a
sale or a purchase. On a client with both "GST/RST on Purchases" and "GST on
Income" it was a coin flip.

**QuickBooks equivalent: NEEDED, and the signal is different.**
- Xero publishes `CanApplyToRevenue` / `CanApplyToExpenses` per rate.
- QuickBooks `TaxCode` instead carries **`SalesTaxRateList`** and
  **`PurchaseTaxRateList`** — a code is usable on sales if its sales list is
  non-empty, and on purchases if its purchase list is non-empty. Different
  shape, same question.
- `src/lib/quickbooks/read.ts` would need a `quickbooks_tax_codes` migration
  mirroring 0980, and `toTaxCode` populating the two optional flags.

**The matcher change is already provider-neutral and DONE**: `matchTaxCode`
takes a `direction` and filters candidates before scoring, and
`QbTaxCode.canApplyToRevenue / canApplyToExpenses` are OPTIONAL — absent means
"no opinion, keep it", which is exactly today's QuickBooks behaviour. So
QuickBooks only needs the two flags populated; no matcher work.

**Tax LEARNING is already fixed for both** — `taxLearnKey()` puts the direction
in the key, so a sale and a purchase with the same taxes no longer share one
remembered rate. Shared code, nothing to redo.

---

## 5. Xero income posting

**Shipped:** PR #972. Unpaid income → `ACCREC` invoice, paid income → `RECEIVE`
bank transaction.

**QuickBooks status: ALREADY BUILT.** `buildInvoicePayload` /
`buildSalesReceiptPayload` have existed since before this work. Nothing to do.

**Shared change that touched QuickBooks:** `draftNeedsInput` now blocks approval
of a PAID sale with no deposit account. Verify this doesn't flip existing
QuickBooks SalesReceipt drafts from "ready" to "needs input" in a way that
surprises the founder — QuickBooks SalesReceipts default to Undeposited Funds,
so a deposit account may be genuinely optional there. **Open question, worth
checking before QuickBooks work starts.**

---

## 6. Remembered bank account — pick it once, not every receipt

**Shipped:** PR #972. New `payment_account` learn signal, keyed by direction.

`suggestPaymentAccount` could only be confident when the client's books held
exactly ONE candidate, so in practice the accountant re-picked the same account
on every paid document forever.

**QuickBooks status: ALREADY DONE.** Entirely in shared code — the learn signal,
the overlay, and `suggestPaymentAccount` itself. QuickBooks gets it for free.

Note: migration 0980 also added `default_payment_account_id` /
`default_deposit_account_id` to `xero_connections`. **These are unused** — the
learned-mappings table turned out to be the better home (already per-client,
already RLS'd, already carries the archived-target degrade). Left in place
rather than churning an applied migration. Do NOT build the QuickBooks mirror of
those columns.

---

## 7. Demo-org sharing (testing only)

**Shipped:** `d10de3e`. Migration 0950 — the `tenant_id` unique index became
partial (`where is_demo = false`).

**QuickBooks equivalent: NOT NEEDED.** Intuit gives every developer a sandbox
company per app, so the one-demo-company constraint that forced this doesn't
exist. `quickbooks_connections_realm_idx` should stay a plain unique index.

---

---

## 8. Tracking categories — DONE on Xero (1020)

A second label on a transaction: the account says what KIND of spend, tracking
says which PART of the business. Fetch, cache, picker, and posted on every line
for all four transaction types. IDs not names on the wire (a rename in Xero
between sync and post fails opaquely). Renders nothing when the organisation has
no categories, which is most of them; never blocks approving or posting.

**QuickBooks equivalent: NEEDED, and a bigger job than it looks.** QuickBooks
splits the same idea across **Classes** and **Locations**, which are two
separate API entities with their own preferences (`ClassTrackingPerTxn`,
`TrackingByCustomer`) and are enabled independently per company. Xero's flat
"at most two categories" model does not map cleanly. Plan it as its own piece
rather than porting `xero_tracking_options`.

---

## 9. Due date — SHARED FIX, verify QuickBooks uses it

Found by posting a real Net 30 invoice and reading it back: it landed due on its
ISSUE date, i.e. immediately overdue. We never extracted a due date at all.

The extraction change is **provider-neutral and already live for both**. What is
NOT done: the QuickBooks builders were not checked for whether they pass
`DueDate` through. Verify before assuming QuickBooks benefits.

---

## 10. Currency — SHARED PROBLEM, QuickBooks NOT fixed (1030)

A CAD invoice posted into a USD organisation was recorded as 6,720 USD. Xero
books in the ORGANISATION's currency unless told otherwise.

Xero now records each organisation's base currency and sends a `CurrencyCode`
when the document differs. **QuickBooks has the identical hazard and no fix**:
`quickbooks_connections` has no base-currency column, and the QBO builders never
send `CurrencyRef`. QBO also requires multicurrency to be ENABLED on the company
before it will accept one, so the QuickBooks version needs that preference read
first — not a copy of the Xero column.

---

## 11. Cache invalidation — FIXED FOR THE WHOLE APP

`localePrefix: "as-needed"` means English pages are served WITHOUT `/en`, but 34
call sites across 18 files revalidated `/en/...`. Silent miss for every English
user, app-wide. New `revalidateAllLocales()` in `src/lib/revalidate.ts`; all call
sites converted. Nothing QuickBooks-specific to do — just do not reintroduce the
`for (const loc of LOCALES) revalidatePath(...)` pattern.

---

## 12. The accuracy eval — extend it, do not rebuild it

`npm run eval:bookkeeping` scores the pipeline against 8 documents with known
answers. It found two real bugs on its first run (RST missing from the tax
vocabulary; a two-product invoice confidently picking one).

When QuickBooks work starts, add QBO cases to the SAME harness rather than
writing a second one. The reference lists in `evals/bookkeeping/cases.ts` are
already a fixed stand-in for a connected organisation.

---

## 13. Register match — duplicate protection (#1006)

**QuickBooks ALREADY HAD THIS** (smart posting Stage 5). This entry exists to
record the three places where Xero could not simply reuse it, and one bug the
Xero side had that QuickBooks does not.

The shared classifier (`lib/quickbooks/register-match.ts` `classifyRegisterMatch`)
is REUSED, not forked. Its entity vocabulary ("bill", "purchase", "invoice",
"salesreceipt") is logical rather than QuickBooks-specific and maps one-to-one
onto Xero's ACCPAY / SPEND / ACCREC / RECEIVE. Its verdict rules are
provider-neutral judgement about money; two copies of that judgement is how they
drift apart. Only the SEARCH is Xero's (`lib/xero/register-match.ts`).

### The three Xero-specific deltas

1. **Currency had to be normalised, not passed through.** QuickBooks only sets
   `CurrencyRef` when the company has multicurrency on, so the classifier reads
   "a candidate carrying a currency" as "this total may not be in the home
   currency — ask". Xero stamps `CurrencyCode` on EVERY transaction. Passed
   through raw, that guard would have refused every Xero match forever.
   Normalised against the organisation's own `base_currency` (migration 1030):
   a candidate in the organisation's currency reports null, a genuinely foreign
   one keeps its code and gets confirmed. An unknown organisation currency keeps
   every code, which errs toward asking.

2. **Two requests, not one → a read failure had to become data.** QuickBooks
   queries one register; a thrown request is the caller's signal. Xero needs
   `Invoices` and `BankTransactions` separately, so `searchXeroRegister` never
   throws and reports `truncated` + `readFailed` instead. The two callers use it
   OPPOSITELY, and that asymmetry is deliberate:
   - the automatic pre-create check FAILS OPEN (logs, creates as usual) — the
     duplicate check must never block a legitimate post;
   - the explicit attach FAILS CLOSED (`post_failed`, retry) — never create the
     very duplicate the accountant just said already exists.
   Note the shared classifier returns `none` for zero candidates even when
   truncated, so `readFailed` is what carries "we could not actually check".

3. **Same-direction registers only.** QuickBooks passes an explicit `entities`
   list; the Xero search scans both endpoints and would otherwise return income
   rows for an expense draft. A same-day, same-amount sale is a coincidence, not
   a duplicate, and surfacing it would train accountants to dismiss the dialog.
   `xeroSearchEntities(direction)` mirrors QuickBooks' `searchEntities`.

### The Xero-only bug this exposed

`undoXeroPost` re-derived the endpoint from the draft's own shape and
unconditionally deleted or voided. Once a draft can be MATCHED that is wrong
twice: it would have removed the CLIENT's own transaction on a button labelled
"Undo", and an unpaid bill matched to a paid bank line would have gone to the
wrong endpoint entirely. Undo now unlinks when `matchedQboType` is set, and
`xeroEndpointForDraft` trusts what was matched. QuickBooks was already correct
here (its void route checks `matched` and skips the delete, and its
attach-receipt route already read `matchedQboType`) — no QuickBooks change
needed.

### Copy

Six `_xero` sibling keys added (`match_title`, `match_body`, `match_gone`,
`post_match_hint`, `matched_label`, `unlink_body`) and the component's existing
`pk()` provider-key helper applied to them. The QuickBooks-worded keys are
untouched.

---

## Still open on Xero (finish before starting QuickBooks)

1. **The demo-only posting gate** in `src/lib/xero/post.ts` still blocks real
   client books. Register-match (section 13) was the last functional gap versus
   the QuickBooks path and shipped in #1006, so what remains is a deliberate
   go-live decision, not more code. The founder DEFERRED it on 2026-07-28.

---

## Cross-cutting lessons worth carrying into the QuickBooks work

- **A write and a read that compute a key differently fail silently.** That is
  how the learn loop stayed dead for a year. Any new keyed lookup gets a
  round-trip test that runs the REAL writer into the REAL reader.
- **Optional flags must default to "keep", never "hide".** Every list filter
  added here treats `undefined` as no-opinion, so an un-migrated or
  un-resynced client never gets an empty picker.
- **A per-provider constraint is not a shared one.** Xero's Reference is not
  QuickBooks' DocNumber; Xero's tax flags are not QuickBooks' rate lists; Xero's
  always-present CurrencyCode is not QuickBooks' optional CurrencyRef. Several
  of the items above are deliberately NOT straight copies.
- **Reuse the judgement, port only the plumbing.** Section 13 shares the entire
  match/no-match decision with QuickBooks and reimplements only the query. Where
  a shared rule needed a different INPUT (currency), the adapter normalised the
  input rather than adding a provider branch inside the shared rule.
