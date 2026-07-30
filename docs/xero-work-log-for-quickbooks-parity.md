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

## 12. The accuracy eval — extend it, do not rebuild it (see also section 16)

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

## 14. What a live end-to-end test found (#1010, #1013)

Register match (section 13) was verified against the founder's real Xero Demo
Company, not just unit tests: a bill was typed into Xero by hand, a matching
receipt went through the client portal, and the draft was approved and posted.
Result: Vylan asked, attached the receipt to the hand-entered bill, created
nothing (bill count held at 34), and Unlink left that bill and its attachment
untouched. Forcing "post a new one" then created normally. The whole chain works.

Two real defects surfaced that no unit test would have caught, because both
depend on the SHAPE OF THE REAL ORGANISATION.

### Fixed: the currency comparison was anchored to the wrong side (#1010)

The Demo Company keeps its books in **USD**. Xero books a transaction in the
organisation's currency unless the post says otherwise, so a USD organisation
holding a CAD document posts CAD — and the match normalised a candidate's
CurrencyCode against the ORGANISATION's currency. A USD 247.83 bill would have
been reported as unambiguous and silently attached to a CAD 247.83 receipt. Same
number, different money: precisely the misstatement `base_currency` was added to
prevent, arriving through the other door. Now compares against the effective
POSTING currency (the document's when stated, the organisation's otherwise),
which is strictly better in all four org/document/candidate combinations.

**Carry into QuickBooks:** the shared classifier's multicurrency guard assumes a
currency on the candidate means "possibly not what we post in". That assumption
is only safe when the comparison currency is the one the transaction will
actually be stated in. QuickBooks' equivalent is `CurrencyRef`; check the same
question there rather than porting the Xero adapter.

### Fixed: one provider-named key missed the pk() helper (#1013)

Unlinking a matched Xero draft said "Nothing is deleted in **QuickBooks**".
Section 13 added `unlink_body_xero` and every other named key in that dialog goes
through the component's `pk()` helper; this call site was left on the QuickBooks
key. Cheap to miss, invisible to tsc, and only visible by clicking the button on
the right provider.

### Was open, fixed in #1016 (see section 15) — a non-CAD document could never be posted

`draftNeedsInput` (src/lib/quickbooks/draft-resolve.ts) returns true whenever
`suggestion.currency != null && suggestion.currency !== "CAD"`. There is no
resolved override for currency, so **nothing in the UI can ever clear it** — the
amber "Amounts appear to be in USD, not CAD" line is permanent and Approve stays
disabled forever. Hit while testing: a USD receipt had to be abandoned and
re-made in CAD to finish the run.

This predates the register-match work and is not a regression. It matters now for
two reasons: Vylan is Canada-wide, and the whole `base_currency` + CurrencyCode
feature exists to handle foreign-currency documents — which this guard makes
unreachable. The honest rule is probably "block only when the document's currency
differs from the organisation's AND the organisation's is unknown", since a
recorded org currency makes the post correct. Deferred to the founder; the same
guard is shared with the QuickBooks path, so fix it once. **Done in #1016**, and
the answer turned out to be per-provider rather than one rule — see section 15.

### Environment notes that cost time

- **`xero_connections.base_currency` is still null** for the only connected
  client — it is written ONLY by the OAuth callback, so a client connected before
  migration 1030 needs a reconnect. Until then a CAD document posts into the USD
  organisation with no CurrencyCode and Xero records it as USD. Verified: the
  bill created during the test reads "Amount USD 247.83" from a CA$247.83
  receipt.
- **A supplier created in Xero is invisible to Vylan's pickers until reconnect.**
  The contact cache is also only rebuilt by the OAuth callback. There is no
  resync endpoint. A "Refresh from Xero" button would remove a genuine
  papercut — the same applies to accounts, tax rates and items.
- The draft card's **Refresh** button DOES recompute a stored suggestion against
  the current cache, which is how a newly-cached vendor gets picked up without
  re-uploading.

---

## 15. Foreign currency: the guard is about CAPABILITY, not Canada (#1016)

The blocker from section 14 is gone. What replaced it is the most important thing
in this document for the QuickBooks work, because **the answer is different per
provider and the difference is a real capability gap, not a preference.**

The question is not "is this document CAD" but **"can the post STATE the
currency"**:

| provider | states a currency? | a foreign document |
| --- | --- | --- |
| Xero, org currency known | yes — explicit `CurrencyCode` | warns, records correctly |
| Xero, org currency unknown | no | still blocks |
| QuickBooks | **no — the payload has no currency field at all** | still blocks |

`lib/quickbooks/post-transaction.ts` sends no currency of any kind. So on
QuickBooks a foreign-currency document would be booked at face value in the
company's own currency: a wrong number that reads as right, which nothing
downstream catches. That is why QuickBooks keeps the hard block and Xero does
not, and it is not something to "port" — **it is the parity gap.**

### The mechanism, and why it stayed small

`TransactionSuggestion.booksCurrency` carries the books' currency, and is set
**only by the path that can state one**. `null` therefore means "we cannot state
a currency", which is exactly the condition under which a foreign document must
stop. Two consequences worth keeping:

- Behaviour is **byte-identical** for QuickBooks (never sets it) and for any Xero
  connection predating migration 1030 (nothing recorded yet). Nobody's queue
  changed on deploy.
- `draftNeedsInput` is reached from **eight** call sites spanning the
  server/client boundary (`draft-queue`, `draft-summary`, `canApproveDraft` →
  the status route, the bulk-approve route, auto-approve, ready-on-accept, the
  card, the queue row). Threading a new argument through all of them would have
  been most of the change. Putting the value **on the suggestion** — which is
  built server-side and persisted as JSON — gave every reader access for free,
  including the two client components. Prefer this shape for anything else a
  draft needs to know about its own connection.

### When QuickBooks currency support is built

1. Add a currency to the QuickBooks post payload (`CurrencyRef`, plus the
   exchange rate QuickBooks wants on a foreign transaction — Xero derives its
   own, QuickBooks does not always). **UNDERSTATED — see section 18: the rate is
   mandatory, and the vendor's own currency must match the transaction's.**
2. Record the QuickBooks company's home currency the way 1030 records Xero's, and
   populate it on connect.
3. Only then set `booksCurrency` on the QuickBooks path. Setting it earlier would
   unblock approval for documents the post still cannot state — the one change
   here that would be actively unsafe to copy across.

Also: the amber note and the card warning now name the books' currency instead of
saying "not CAD" (new key `foreign_currency_books`; the CAD-worded
`foreign_currency` stays for the unknown case). Any future provider-named or
country-named copy should assume neither.

### What is NOT solved

Real multi-currency accounting — exchange rates, gain/loss on settlement,
dual-currency reporting. This removes a wall so foreign documents can be recorded
correctly; it does not make Vylan a multi-currency ledger.

---

## 16. The accuracy eval, measured for the first time (#1029)

Section 12 said "extend it, do not rebuild it". Extended: 8 cases to 23, and each
one now declares HOW IT WAS CAPTURED — clean scan, phone photo on a desk, faded
thermal roll, photocopy — because rendering everything as a pristine 760px
screenshot flattered the pipeline. Distortions are hashed from the case id rather
than random, so a score only moves when accuracy moves.

**The harness had never actually called the AI.** Vitest does not load
`.env.local`, `ANTHROPIC_API_KEY` was therefore absent, and `extractTransaction`
returns null quietly by design — so the suite completed in 296ms reporting 0%
accuracy. Every accuracy figure quoted before 2026-07-29 was fictional. It now
loads the file and throws if the key is missing.

### ⚠️ The score below is CLAUDE's, and production runs OpenAI (#1034)

`getProvider()` (src/lib/ai/classify.ts) defaults to Anthropic and flips only on
`AI_CLASSIFIER_PROVIDER=openai`. Both the classifier and the transaction
extractor ride that one switch. `.env.local` sets no provider, so this run took
the default and scored 23 documents on **claude-sonnet-4-6** while production is
set to **openai**. The numbers are real; they describe a model the product does
not ship — a subtler failure than the no-key one above, because it looks
entirely plausible.

Since #1034 the harness refuses to start unless the SELECTED provider's key is
present, warns when the provider was defaulted, and stamps every scorecard with
provider and model. To measure what is actually shipped:

```
AI_CLASSIFIER_PROVIDER=openai npm run eval:bookkeeping
```

That needs `OPENAI_API_KEY` locally (copy it from Vercel). **Until that run
happens there is NO measured accuracy figure for production.**

### First measured score, 23 cases — ANTHROPIC ONLY

| dimension | score |
| --- | --- |
| direction, total, document number, paid, line items, party, tax | 100% |
| document date | 20/21 |
| expense account | 13/17 (four MISSES, no errors) |
| refused a non-transaction | 2/2 |

The four account misses are suppliers whose account is obvious (Petro-Canada →
Motor Vehicle, Bell → Telephone). They cost a click and the learn loop closes
each permanently after one correction — worth knowing before anyone "improves"
account matching, because the ceiling on that number is a product choice, not a
model limit.

### The bug it found: numeric date order

Found on Claude. The fix is a change to the shared system prompt and schema
description, which BOTH providers read, so it applies to OpenAI as well — but it
has not been measured there. Treat "dates 20/21" as an Anthropic figure.

`08/06/2026` on a Winnipeg receipt came back as 2026-08-06 — August 6 instead of
June 8. The total was right; only the date was wrong, which nobody spots by eye
and which lands the expense in the wrong month and potentially the wrong GST
filing period.

The prompt now resolves in order: a spelled-out month decides it → any component
over 12 decides it → otherwise **the document's own country** decides it
(GST/HST/QST/RST, a province code, a postal code or French → day-first; a US
state with a ZIP or "Sales tax" → month-first) → failing everything, day-first.

**Written as "read the document's country", NOT "Canada is day-first."** That
distinction is the whole point: the second version breaks every American receipt,
and this is shared with the QuickBooks path. Any future locale-dependent rule
belongs in the same shape.

Also hardened against assembling a date from nearby digits: a till receipt is
full of numbers that are not the date (site, terminal, pump, auth, transaction,
the time), so it must come from a labelled field, and an unreadable one must be
null. A null date asks the accountant; a guessed one silently books the wrong
period.

### One failure deliberately left in

On the faded thermal fuel receipt the month digit "06" reads as "04". The
ordering and the day are now correct and every other field on that document is
exact; it is legible when zoomed, so this is a limit on low-contrast thermal
print rather than reasoning. Easing that case's fade to make it pass would be
cheating a test the founder relies on, so the assertion is a **named baseline of
one known wrong value** — any NEW wrong value still fails. If it starts passing,
drop the allowance to zero rather than leave the slack lying around.

### Harness lessons

- Chrome does not exit after `--screenshot`. Waiting for it cost 45s per case and
  blew the timeout; polling for the file and killing the process does 23 cases in
  26s. A shared profile makes it worse — the next launch blocks on the lock.
- A verdict without values is not a finding. "WRONG" sent one investigation off
  to write a throwaway probe; the scorecard prints got and want now.
- Render and LOOK at a new case (`render.test.ts`, no AI, free). The first
  thermal render was illegible and clipped the totals column off the right edge,
  which would have scored as model failure.

---

## 17. QuickBooks parity — what actually shipped (#1045, #1047, #1050)

Worked straight down this document. Every item was VERIFIED IN CODE before being
touched, and two of the log's own predictions turned out to be wrong in useful
ways.

### Done

| § | item | outcome |
| --- | --- | --- |
| 9 | Due date | **Was broken.** The builders never passed `DueDate`, so every QuickBooks bill landed due on its issue date — immediately overdue. Confirmed against Intuit's field list that `DueDate` is writable on Bill. |
| 3 | Reference fallback | **Was missing**, and deliberately NOT a copy — see below. |
| 5 | Deposit account on a paid sale | **Was a real bug**, exactly as this log's open question suspected. |
| 4 | Tax direction | **Needed**, and the signal is `SalesTaxRateList` / `PurchaseTaxRateList`, as predicted. Migration 1050. |
| 10, 15 | Currency | **Half done** — the recording half. Migration 1060. See below. |
| 2 | Publish status | **Nothing to build**, but for a better reason than this log guessed. |

### The reference fallback is NOT the Xero one, and this is the trap

QuickBooks caps `DocNumber` at 21 characters where Xero allows 255, so `VYL-` plus
a whole uuid gets sliced into noise.

Worse: **QuickBooks' `DocNumber` on an Invoice IS the number the customer sees**,
and QuickBooks assigns its own when the field is omitted. Xero's `Reference` is a
separate internal field, which is why the Xero fallback is safe on income and this
one is not. So the QuickBooks fallback applies to **bills and purchases only**.
Copying Xero here would have printed "VYL-ac5776aa…" on clients' customer-facing
invoices as the invoice number.

Generalise from this: **the same-sounding field is not the same field.** Check
what a provider SHOWS the end customer before writing to it.

### §5 was right to be flagged as an open question

`buildSalesReceiptPayload` deliberately OMITS `DepositToAccountRef` — its own
comment says QuickBooks records to Undeposited Funds and "no bank account is
required to post, unlike a paid expense" — while `draftNeedsInput` demanded one
for any paid sale. Every QuickBooks paid-sale draft therefore waited on a
mandatory pick the builder then discarded.

Fixed as a CAPABILITY on the suggestion (`depositAccountRequired`), not a provider
name, for the same reason as `booksCurrency`. It defaults to REQUIRED so older
stored suggestions and any future producer that forgets stay safe: an unnecessary
question costs a click, a missing bank account on a Xero RECEIVE fails the post.

### §4 needed the READS made tolerant first

All three cached-list readers turn ANY query error into "no cached lists at all".
Adding two columns to their selects would have stripped every QuickBooks draft of
its vendor, account AND tax matches between the merge and the SQL being run — and
1040 was sitting unapplied at the time, so the window was real. Each reader now
retries with the basic column set on a missing-schema error, keeping its client
scope. The write degrades the same way.

**Rule for any future cache column: make the read tolerant in the same commit.**

### §10/§15 currency: recording only, and stopping there was the point

§15's own order is record first, set `booksCurrency` second. Setting it before the
payload can state a currency would unblock approval for documents that then post
at face value in the wrong currency — the exact misstatement the feature exists to
prevent. So #1050 records and changes nothing about posting or approval.

Not a copy of 1030 because **QuickBooks refuses a `CurrencyRef` unless
multicurrency is switched on for the company**, so the home currency alone cannot
decide expressibility. Both facts live on the **Preferences** entity, not
`CompanyInfo`. `multicurrency_enabled` is three-state: `false` is "this company
cannot take a CurrencyRef", `null` is "we never looked".

**STILL TO DO:** the payload half — send `CurrencyRef` when the document differs
from the home currency AND multicurrency is on, then set `booksCurrency` on the
QuickBooks producers so approval opens up exactly where the post can express the
currency. Deliberately NOT written blind: the Xero equivalent was only correct
because it was posted into a real organisation and read back, which is how the
compare-against-the-organisation bug was found. This needs a QuickBooks company
that is safe to post into.

### §2 publish status: nothing to build, better reason

This log guessed QuickBooks has "no three-state equivalent". Closer to the truth:
QuickBooks Advanced and Enterprise DO have a bill-approval workflow with
Approved / Needs Approval / Pending Approval — but **the API does not return or
accept that status**, so Vylan cannot participate either way. A bill Vylan posts
enters the client's own approval workflow by QuickBooks' rules, not by anything
Vylan sets. Correct action is still to build nothing and invent no status.

*Sourcing caveat: Intuit's Bill reference page would not render for automated
reading, so this rests on the SDK field listings plus Intuit's help content rather
than the canonical reference. The safe action is identical either way, which is
why it was acceptable to conclude on that basis — a stronger claim would need the
page read by hand.*

### QuickBooks undo is a different mechanism, as §2 warned

Xero juggles VOIDED vs DELETED by publish status. QuickBooks uses
`?operation=delete` with a **SyncToken** (Xero has none). The failure mode to
watch is therefore not draft state but **applied payments** — a bill with a bill
payment against it, or an invoice with a payment received, is expected to refuse
deletion. The code already fails loudly (records `post_error`, surfaces QuickBooks'
own message on the card) rather than silently, so nothing was changed. **Flagged
as unverified:** no live QuickBooks company was available to reproduce it.

---

## 18. QuickBooks multicurrency is a BIGGER feature than Xero's — measured, not guessed

Tested against a real Intuit sandbox ("Sandbox Company CA", home currency CAD,
multicurrency ENABLED) by posting actual bills and reading the errors back. Every
line below is an observed API response, not documentation.

### What was confirmed

`fetchCurrencyPrefs` reads the right thing. Raw response:
`{"MultiCurrencyEnabled":true,"HomeCurrency":{"value":"CAD"}}` — exactly the shape
the parser assumes. Section 17's recording half is correct.

### Two constraints Xero does not have, and section 15 underestimated both

**1. An ExchangeRate is REQUIRED, not optional.** Posting a USD bill with a
`CurrencyRef` and no rate:

```
400  code 2410  "Curreny, ExchangeRate is missing."
     "The currency and exchange rate are required for transaction in foreign currency."
```

Xero derives its own rate. QuickBooks refuses the transaction outright. Section 15
said QuickBooks "does not always" derive one — it never does.

**CORRECTED (see section 19): this does NOT block the feature.** QuickBooks will
hand over the rate it uses itself, via `GET /exchangerate`. The sentence that
originally stood here — "Vylan has no source of exchange rates" — was wrong, and
wrong in the expensive direction: it made a solvable problem look like a wall.

**2. The transaction's currency must MATCH THE VENDOR'S OWN currency.** In
QuickBooks a vendor is denominated in a currency, and a bill cannot depart from
it:

| bill currency | vendor currency | result |
| --- | --- | --- |
| USD + rate | CAD | `6000` — "You can only use one foreign currency per transaction." |
| USD + rate | HKD | `6000` — same |
| HKD + rate | HKD | **accepted** (id 190, rate 0.18) |
| CAD, no currency fields | CAD | accepted (the control) |

So a USD receipt cannot be posted to a supplier set up in CAD at all. Recording it
requires a USD-denominated vendor record to exist first.

### Why this is not a patch

Vylan's matcher picks a vendor by NAME from the cached list and knows nothing
about vendor currency. A foreign-currency receipt matched to the (correctly
named) CAD supplier would fail at post time with "you can only use one foreign
currency per transaction" — a message that explains nothing to an accountant.

A real implementation needs all three:

1. **Cache each vendor's currency** (`Vendor.CurrencyRef`, already returned by the
   query the sync runs) and surface it in the matcher, so a foreign document can
   only match a vendor of that currency.
2. **A way to create or choose a correctly-denominated vendor** when none exists —
   note that a vendor's currency is FIXED AT CREATION in QuickBooks and cannot be
   changed afterwards, so this is a real decision, not a silent fixup.
3. **An exchange-rate source**, or an accountant-supplied rate on the draft.

### Therefore: today's behaviour is CORRECT, keep it

Foreign-currency documents are blocked on the QuickBooks path
(`booksCurrency` stays null, so `draftNeedsInput` holds them). That is not a gap
to close quickly — it is the safe answer until the three pieces above exist.
**Do not set `booksCurrency` on the QuickBooks producers** to "unblock" it: the
post would then fail at Intuit with a cryptic validation error, or worse succeed
against a mismatched vendor if Intuit ever relaxes the rule.

Xero remains genuinely easier here, and that asymmetry is real rather than an
artefact of how each integration was written.

*Test artefacts left in the sandbox: bills id 189 (CAD control) and id 190 (HKD),
both DocNumber `VYL-CUR-*`. Harmless, and a sandbox reset clears them.*

---

## 19. The two blockers from section 18, answered by testing

Both of section 18's obstacles were probed against the same live sandbox. One
dissolves completely; the other narrows to something workable. Every line is an
observed response.

### Exchange rates: SOLVED — QuickBooks gives us its own

```
GET /v3/company/{realm}/exchangerate?sourcecurrencycode=USD&asofdate=2026-07-30
200 {"ExchangeRate":{"SourceCurrencyCode":"USD","TargetCurrencyCode":"CAD",
     "Rate":1.400374,"AsOfDate":"2026-07-30","domain":"QBO"}}
```

This is the ideal source and better than any alternative that was on the table:
it is **the same rate the client's own books use**, so a posted bill can never
disagree with QuickBooks' own reporting. No external FX provider, no new
dependency, no subscription, no drift between Vylan's number and Intuit's.

Section 18 claimed Vylan had no rate source and that this alone blocked the
feature. That was wrong. Corrected above.

### Supplier currency: READABLE, so the matcher can be made currency-aware

`Vendor.CurrencyRef` comes back on every vendor — `{"value":"CAD","name":"Canadian
Dollar"}` — in the same query the sync already runs. Caching it is the same shape
of change as 1050's tax-direction columns.

### The real remaining constraint: Vylan CANNOT create a foreign-currency supplier

Tested four ways, all against a company where USD is already an ACTIVE currency
(`CompanyCurrency` returns HKD, EUR, USD — so the active-currency list is not the
obstacle):

| attempt | result |
| --- | --- |
| create vendor, `CurrencyRef: {value:"USD"}` | **200 OK, vendor created as CAD** |
| create vendor, `CurrencyRef: {value,name}` | **200 OK, vendor created as CAD** |
| sparse-update an HKD vendor to USD | **200 OK, still HKD** |
| the seeded HKD vendor (made in the QuickBooks UI) | genuinely HKD |

So QuickBooks **silently ignores `CurrencyRef` on vendor create and update over
the API**, returning 200 with the home currency instead. Note the failure mode —
success status, wrong result, no error anywhere. The same quiet-failure family as
everything else in this document.

A foreign-currency supplier therefore has to be created by the accountant in
QuickBooks itself, where the currency is chosen at creation and then fixed
forever.

### What this makes buildable

The feature is now fully specified with no unknowns left:

1. **Cache `Vendor.CurrencyRef`** — mirrors 1050.
2. **Make the matcher currency-aware**: a document in a foreign currency may only
   match a supplier denominated in that currency. When none exists, say so
   plainly — "this receipt is in USD; create a USD supplier in QuickBooks first"
   — rather than matching the correctly-named CAD supplier and failing at post
   time with "you can only use one foreign currency per transaction", which tells
   an accountant nothing.
3. **Fetch the rate from QuickBooks** at post time and send it as `ExchangeRate`.
4. **Only then** set `booksCurrency` on the QuickBooks producers, so approval
   opens exactly when all three conditions can be met and not before.

Until 2 and 3 exist, section 18's conclusion stands: keep foreign-currency
documents blocked on the QuickBooks path.

*Further sandbox artefacts from this round: vendors id 69, 70 and two `VYL A/B`
test vendors (all created as CAD), plus bill `VYL-FX-OK` attempts. A sandbox reset
clears everything.*

---

## Still open on Xero (finish before starting QuickBooks)

1. ~~**The demo-only posting gate** in `src/lib/xero/post.ts` still blocks real
   client books~~ — **LIFTED on 2026-07-29.** Register-match (section 13) was the
   last functional gap versus the QuickBooks path and shipped in #1006, and
   section 14 verified the whole chain against a real organisation, so what
   remained was a deliberate go-live decision, not more code. The founder
   deferred it on 2026-07-28 and called for it the next day. The gate was one
   server-side check (`isClientXeroDemoOrg`, now deleted — it had no other
   caller); the UI already rendered the Post button for Xero drafts, gating only
   on unknown DIRECTION, so removing the check was the whole change. New
   `src/lib/xero/post.test.ts` asserts a real org posts, and is written so a
   re-added demo check fails the suite rather than passing quietly.

2. **Undo and post dispatch on the CURRENT connection, not the recorded
   provider.** Pre-existing, and unrelated to the gate — but it now matters more,
   because a misrouted undo strands a transaction in a REAL ledger. `posted_realm_id`
   holds a QuickBooks realmId and a Xero tenantId in one column with no provider
   discriminator, so `postApprovedDraftForFile` and the void route both ask
   "is this client Xero-connected *right now*". A client who switches providers
   after posting sends the wrong id to the wrong API: the draft stays `posted`,
   the entry stays in the books, and there is no in-app way back. Needs a
   `posted_provider` column plus a shared dispatch, kept revertable on its own.

3. ~~A non-CAD document can never be approved~~ — **fixed in #1016** (section
   15). The founder asked for it once American firms came into view.

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
