# Cohesion audit — where one change doesn't reach everywhere

**Run:** 2026-08-03 · **Status:** findings only, nothing changed yet.

## Why this exists

The founder's report, in his words: *"if I decide to expand upon organizers, it
does not update on all the ends of the feature. It'll only update on the main
end."* And: *"I'm changing how the settings UI looks in the actual settings, and
I want it to update in firm settings too — I didn't explicitly say to."*

That is the symptom. This document is the diagnosis: every place in the codebase
where one idea has been written down more than once, so that changing it once
changes only part of the product.

The standing rule that stops NEW copies appearing is now in `CLAUDE.md`
("Cohesion — one concept, one component"). This audit covers the copies that
already exist.

---

## The pattern behind all of it

Three of the findings below share one shape, and it's worth naming because it
predicts where else to look:

**A shared version already exists, and most of the code ignores it.**

That's worse than having no standard at all, because the standard's existence
makes everyone assume it's being used. In every case below, someone did the
right thing once, and the rest of the app never found out.

---

## Finding 1 — the same search function, written four times, two of them wrong

**Severity: high — this is a live bug, not untidiness.**

`normalizeText` folds accents and case so that typing `securite` finds
`Sécurité`. It exists four times:

| Where | Behaviour |
|---|---|
| [src/lib/text/normalize.ts:26](src/lib/text/normalize.ts:26) | correct — handles accents AND ligatures |
| [archive-filter.ts:32](src/components/clients/client-archive/archive-filter.ts:32) | exact photocopy of the above, comment included |
| [preview-model.ts:79](src/components/engagements/engagement-preview/preview-model.ts:79) | **drifted** — accents only, no ligatures |
| [engagement-chat/search.ts:80](src/lib/engagement-chat/search.ts:80) | **drifted differently** — accents only, plus a `.trim()` |

The two drifted copies use `NFD` instead of `NFKD` and skip the œ/æ mapping.
Verified by running all four against real inputs:

| You type | Record says | lib/text | preview + chat |
|---|---|---|---|
| `soeur` | Sœur Marie | found | **not found** |
| `aequitas` | Æquitas | found | **not found** |
| `finance` | ﬁnance (ligature) | found | **not found** |
| `securite` | Sécurité | found | found |

So the same French client name is findable on one screen and invisible on
another. For a product that ships Québec RL-slips, that matters.

**The tell:** `src/lib/text/normalize.ts` opens with a comment saying an
identical copy lives in `archive-filter.ts` and should be pointed at this module
"when convenient." A previous session *found* the duplication, wrote it in a
comment, and moved on — and only found 1 of the 3 copies. A note in a file
nobody re-reads is not a fix. This is precisely why it had to become a rule.

**Why CI never caught it:** all four copies have tests, and all four pass. Only
the two *correct* copies test the ligature case — each test file asserts what its
own copy happens to do, not what the concept is supposed to do. Duplicated code
brings duplicated tests, and duplicated tests certify the drift instead of
catching it. Worth remembering: green tests are not evidence that two copies
agree.

**Fix size:** small. One shared import, delete three copies, keep the tests and
point them all at the shared function. Needs a decision on whether `.trim()`
becomes standard (it should).

---

## Finding 2 — "restyle the settings" has no single place to do it

**Severity: high — this is the founder's exact second question.**

There is a 441-line specification at [docs/design-system.md](docs/design-system.md)
describing type scale, shadows, radii, card anatomy and an "eyebrow" label
style. Checked every token it defines against the code:

| Documented token | Exists in code? |
|---|---|
| `text-h1`, `text-h2`, `text-h3`, `text-body-lg` | no |
| `text-eyebrow` | no |
| `shadow-1` … `shadow-4` | no |
| `radius-lg` | exists, but 10px in code vs 8px in the doc |

The design system is prose. Nothing implements it. So there is no shared style
layer to change — "restyle settings" can only ever be a per-file hunt, which is
exactly what the founder is experiencing.

What that produces in practice:

- **Section labels ("eyebrow"):** 49 files draw one, in at least **12 different
  styles** — 10px / 11px / 12px / sm, medium vs semibold, `tracking-wide` vs
  `tracking-[0.1em]` vs `tracking-[0.12em]` vs `tracking-wider`. The word
  "eyebrow" appears 45 times in the code as prop names and comments, so everyone
  agrees the concept exists; nobody shares an implementation of it.
- **Cards/panels:** 10 files use the shared `ui/card` primitive. **35 hand-roll
  their own** container instead. Among the hand-rolled ones, `rounded-xl` vs
  `rounded-2xl`, `border-border` vs `border-border/60`, with and without
  `shadow-sm`. Three of those 35 are settings pages (audit, health, team).
- The design doc says **"No `radius-2xl` or larger — pillow-shaped corners read
  consumer-app, not financial-software."** The code has 45 uses of `rounded-2xl`
  and 3 of `rounded-3xl` across 29 files.

**Fix size:** medium, and it's the highest-leverage item here. Implement the
tokens the doc already specifies, extract `<SectionLabel>` and adopt the
existing `<Card>`, then the founder's "change it once" becomes literally true
for styling.

---

## Finding 3 — the same words, typed under many different keys

**Severity: medium.**

Of 3,865 translation keys, **369 distinct English strings are written under two
or more keys**. "Cancel" exists 22 times, "Clients" 13, "Email" 10.

Most are harmless, but duplication has already produced visible inconsistency:
**"View all" is written under 7 keys and has three different French
translations** — *Tout voir*, *Voir tout*, *Tout afficher*. The French app says
the same thing three ways depending on which screen you're on.

Honest caveat: **some of this duplication is correct.** "Active" has 10 keys and
two French forms (*Actif* / *Actifs*) because French agrees with number — that
one is right and should stay. This is not a case where the count is the problem;
the problem is only where the same phrase drifted.

A `Common.*` namespace already exists (`Common.save`, `Common.delete`) — the
same half-adopted-standard pattern as Findings 1 and 2.

**Fix size:** small per string, and safe to do opportunistically. Note the
project rule that translation keys are add-only and removals are founder-gated,
so this one needs sign-off before deleting anything.

---

## Finding 4 — smaller duplicated helpers

**Severity: low-medium.** Each of these is one function written twice:

| Function | Copies |
|---|---|
| `toCents` | [close/book-balance.ts:38](src/lib/close/book-balance.ts:38), [ai/payout-reconcile.ts:39](src/lib/ai/payout-reconcile.ts:39) |
| `daysInMonth` | [close/period.ts:50](src/lib/close/period.ts:50), [recurring/schedule.ts:108](src/lib/recurring/schedule.ts:108) |
| `periodLabel` | [close/period.ts:83](src/lib/close/period.ts:83), [recurring/naming.ts:11](src/lib/recurring/naming.ts:11) |
| `deriveNetAmount` | [xero/post-transaction.ts:108](src/lib/xero/post-transaction.ts:108), [quickbooks/post-transaction.ts:42](src/lib/quickbooks/post-transaction.ts:42) |
| `buildSystemPrompt` | [ai/assistant.ts:110](src/lib/ai/assistant.ts:110), [ai/classify.ts:398](src/lib/ai/classify.ts:398) |

`toCents` and `deriveNetAmount` are the two worth looking at first — they handle
money, and the Xero and QuickBooks versions of `deriveNetAmount` answering
differently would be a real accounting discrepancy.

### Not a duplicate, but a trap: `listClientFolders`

Two functions share this name in the same layer and mean **completely different
things** — [db/folders.ts:35](src/lib/db/folders.ts:35) lists real folders
inside one client; [db/documents.ts:212](src/lib/db/documents.ts:212) lists
clients-as-folders for the drive view. Both are correct. The name is the bug:
sooner or later someone imports the wrong one. Worth renaming, but it is a
naming problem, not a cohesion problem, and it is listed here so it isn't
mistaken for one.

---

## Finding 5 — data access is spread out, but mostly harmlessly

**Severity: low. Recorded so it isn't re-investigated later.**

Client and engagement tables are queried from well outside the data layer: 34
files outside `src/lib/db/` query `clients` directly and 68 query `engagements`.
That looks alarming, and the first instinct is to call it duplication.

Checked what those queries actually do, and mostly they are **narrow lookups** —
`select("id")` for an ownership check, `select("id, firm_id")` for a permission
guard. Those are fine and should be left alone. Only a couple genuinely restate
a concept the data layer already owns (one re-selects the full client profile
column list; `select("id, display_name")` — the client-name lookup — appears
four times).

By contrast `documents` and `firm_members` are queried through the data layer
only. That's the shape to aim for, and it shows the codebase already knows how.

**Fix size:** small, and low priority. Not worth a dedicated pass; fold it in
when touching those files for another reason.

---

## Finding 6 — the download audit log is silently incomplete

**Severity: highest in this audit. This is a trust problem, not a tidiness one.**

`/settings/audit` has a filterable event type called "file downloaded"
([audit-actions.ts:91](src/components/settings/audit-actions.ts:91)). Traced
where that event is actually written:

- It is written in exactly one function —
  [documents.ts:325](src/app/actions/documents.ts:325).
- That function is called from exactly one component —
  [document-actions-menu.tsx:102](src/components/files/document-actions-menu.tsx:102),
  the Files v2 grid.
- There are **six** places a document can be downloaded. The other five —
  engagement checklist, engagement preview card, preview detail, client archive,
  portal deliverables — go straight to a route and log nothing.
- Confirmed the routes don't quietly log server-side instead:
  `src/app/api/files/[id]/route.ts` contains no logging at all. (The portal has
  its own separate `client_downloaded_deliverable` event, written to the
  client-facing activity feed, not the firm audit log.)

So the audit screen offers a "file downloaded" filter that returns a fraction of
real downloads, with nothing indicating the rest are missing. A missing feature
is visibly missing; a log that looks complete and isn't is worse, and for an
accounting product holding client tax documents it's the kind of thing that
matters if anyone ever asks who accessed a file.

**Checked the obvious objection — "maybe those are different kinds of file with
their own logs."** They aren't. The logging function's own source map
([documents.ts:42](src/app/actions/documents.ts:42)) explicitly covers three
sources: `checklist` → `uploaded_files`, `final` → `final_documents`, and
`imported` → `imported_documents`. Those are precisely the files the engagement
checklist and the finals list download. The logging was *built* to cover them.
It is simply never called from those screens.

**This is the cohesion problem in its most expensive form:** download was built
six times, the audit call was added to the copy someone happened to be working
in, and the other five were never revisited. The plumbing already accepts them,
which is also why the fix is small.

**Fix size:** small, and it should probably jump the queue. Move the logging
into the API routes rather than the components, so it fires regardless of which
surface triggered it — a route can't be bypassed the way a component can.

---

## Finding 7 — nine different document status pills

**Severity: high.**

Status pills for documents are independently implemented in at least eight
files, each with its own state list, its own wording and its own colours:
`portal/item-card.tsx` (twice — two different pills in one file),
`portal/signature-item-card.tsx`, `client-archive-view.tsx`,
`file-preview-row.tsx`, `preview-card.tsx`, `quickbooks/queue-row.tsx`,
`quickbooks-draft-card.tsx`, `usability-badge.tsx`.

Proof they're copies rather than a shared thing: this exact string appears in
two separate files, character for character —

```
inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium
```

([item-card.tsx:1020](src/components/portal/item-card.tsx:1020),
[signature-item-card.tsx:210](src/components/portal/signature-item-card.tsx:210))

And they have already drifted in a way that loses information:
[quickbooks-draft-card.tsx:190](src/components/engagements/quickbooks-draft-card.tsx:190)
handles four states where its sibling
[queue-row.tsx:71](src/components/quickbooks/queue-row.tsx:71) handles five — a
draft that "needs input" shows as a generic "Draft" on one screen and "Needs
input" on the other.

There *is* a shared pill helper, `engagementStatusVariant` — but it has only 3
call sites and covers *engagement* status, never document status. Same
half-adopted-standard pattern as Findings 1, 2 and 3.

**Fix size:** large, and it needs a product decision first. There are genuinely
four different status vocabularies in the data model (portal request items,
document review status, AI headline kinds, QuickBooks queue buckets). Someone
has to decide what the canonical set is before a single pill can be built. This
is the one finding I would not start without the founder in the room.

---

## Finding 8 — two places decide "is this document flagged?"

**Severity: medium-high, and it needs a product ruling, not just a refactor.**

Two functions read the same raw fields (`review_status`, `ai_usability`,
`ai_rejected`, `ai_extracted_fields`) and both call the same shared
`matchDocument` comparator, but each writes its own precedence chain:

- [preview-model.ts:99](src/components/engagements/engagement-preview/preview-model.ts:99)
  `resolvePreviewStatus` — the accountant's decision wins. An approved file
  reads approved.
- [file-ai-headline.ts](src/lib/engagements/file-ai-headline.ts) `deriveFileAi`
  → `pickAiHeadline` — `review_status` is never passed into the chain at all
  (it's used only to suppress the headline on files that were never analyzed).

**Correcting the scan's framing here, because the distinction matters:** these
are not strictly two copies of one function. They answer slightly different
questions — "what is this file's status" versus "what did the AI conclude". The
real finding is that both encode the same underlying *business rule* — when an
AI concern should outrank the accountant's judgement — and they answer it
differently. For a file the accountant approved but the AI disliked, the preview
grid shows green and the checklist row shows a warning chip.

I can't tell from the code whether that's deliberate. It may well be intended.
**That's a question for the founder, not a bug I should fix.** What is not in
question is that the rule lives in two places, so changing it means changing
both — and `preview-model.ts`'s own comments show this rule has already needed
correcting once.

---

## Finding 9 — only one screen knows what kind of file it's showing

**Severity: low-medium.**

`iconForMime` at
[file-browser.tsx:104](src/components/files/file-browser.tsx:104) is the only
code in the app that picks an icon from the file's type. Every other document
row hardcodes one glyph — a spreadsheet, a Word doc and a PDF all render an
identical page icon in the engagement checklist, the finals list, the client
archive, the portal and the client overview.

Two of those surfaces already have the file-type data loaded and ignore it. One
(the client archive) genuinely can't — `ArchiveFile` has no `mimeType` field —
so that one needs a data change first, not just a render change.

Worth stating as the counter-example: **file size formatting is done right.**
One `formatBytes` in [src/lib/format.ts:79](src/lib/format.ts:79), reused by
seven surfaces, zero re-implementations. Same for document *type* labels in
`src/lib/doc-types.ts`. The codebase does know how to do this — it just hasn't
done it consistently.

**Fix size:** small. Move `iconForMime` into a shared helper and point the
hardcoded spots at it.

---

## Finding 10 — a shared component that can't be adapted will be copied

**Severity: high. This is the most useful finding in the audit, because it
explains the *mechanism* rather than just listing symptoms.**

While this audit was running, another session shipped
[src/components/ui/panel.tsx](src/components/ui/panel.tsx) — 34 seconds after
this audit's first commit. Its own header comment reads:

> "Extracted because the client page and the teammate profile had grown their
> own byte-identical copies, and a third page was about to."

So a second session independently hit this exact problem on the same day and
reached the same conclusion. That is strong corroboration that the founder's
instinct is describing something real and recurring, not a one-off.

`Panel` is the canonical titled section box. It has **2 call sites**. Five other
files hand-roll its exact outer shell instead:
[engagements/[id]/page.tsx](src/app/[locale]/(app)/engagements/[id]/page.tsx),
[quickbooks/drafts/page.tsx](src/app/[locale]/(app)/quickbooks/drafts/page.tsx),
[relationships-card.tsx](src/components/clients/relationships-card.tsx),
[roles-workbench.tsx](src/components/settings/team/roles-workbench.tsx),
[team-manager.tsx](src/components/settings/team/team-manager.tsx).

**And here is the part worth stopping on.** One of those forks carries this
comment at [relationships-card.tsx:116](src/components/clients/relationships-card.tsx:116):

> "Same anatomy as Panel in clients/[id]/page.tsx. The id anchors the engagement
> header's 'linked clients' line."

The author **knew `Panel` existed and copied it anyway** — because they needed an
`id` on the element, and `Panel` accepts no `id`, no `className`, and no
props passthrough at all (verified: zero occurrences in the file).

So the fork wasn't laziness. It was forced. **A shared component that can't be
adapted to a slightly different need will be copied, every time.** Telling
people to reuse more doesn't fix that; making the shared thing flexible does.

Fairness note: `Panel` is a day old, so the five hand-rolled copies *predate* it
rather than ignore it. The lesson isn't that anyone did something wrong — it's
about what has to be true for the new component to actually win.

**Fix size:** small. Add `className` / `id` passthrough to `Panel`, then convert
the five copies. Doing the passthrough *first* is what makes the conversion
possible at all.

---

## Finding 11 — your exact example, found in the code

**Severity: high. This is "I restyled settings and firm settings didn't follow,"
located precisely.**

The firm's settings live in two places the product's own menu treats as one
thing: `/settings?tab=account` and `/settings/team?tab=settings`.

The good news: the actual settings component, `TeamSettings`, **is properly
shared** — one component, rendered in both places. The content is not duplicated.

The problem is the box around it. Same component, two completely different
wrappers:

- In `/settings` — a heading and a hint line, no border:
  `<h2 className="text-sm font-semibold">` + `<p className="mt-1 text-xs …">`
- In `/settings/team` — a bordered card, no heading and no hint at all:
  `<div className="rounded-xl border border-border/60 bg-card p-5">`

They currently look plausible side by side only because both happen to use the
same colour tokens — not because they share any code. Restyle one and the other
cannot follow, which is exactly what you experienced.

**Fix size:** medium. Pick which shell wins (`Panel` is the obvious candidate
once Finding 10's passthrough lands) and point both call sites at it.

---

## Finding 12 — settings chrome is hand-written every time

**Severity: medium-high.** Supporting detail for Finding 11 — this is *why*
there was nothing shared to change.

- **Section header** (title + hint underneath): hand-written in ~14 files, with
  no shared component. Proof it's retyped rather than copied from one source:
  `profile-form.tsx` contains *both* class orderings —
  `"text-xs text-muted-foreground mt-1"` at lines 133 and 228, and
  `"mt-1 text-xs text-muted-foreground"` at line 333. Same file, same
  developer, two spellings of the identical style.
- **Settings toggle row** (label + description + switch): five different
  treatments, differing in border presence, border opacity, background tint,
  padding and whether there's an icon. Three of the five have no box at all.
- Within `settings-form.tsx` alone, **one identical row class string is repeated
  five times** (lines 1040, 1057, 1079, 1100, 1129) for the five document
  toggles.

**Fix size:** small. One `<SettingsSection>` (header + hint) and one
`<SettingRow>`. The `ToggleRow` in
[team/firm-settings.tsx:15](src/components/settings/team/firm-settings.tsx:15)
is already most of the way there and is the best candidate to promote.

### Correcting one thing from the scan

The scan listed "portal settings" as a surface it couldn't find and flagged that
rather than inventing a finding. That was the right call — there is no
firm-facing portal settings screen; `src/components/portal/**` is the
client-facing portal itself. Noting it so nobody re-searches for it.

---

## Finding 13 — every amount in the app is formatted as Canadian dollars

**Severity: high, and it's a correctness bug with a visible symptom.**

[format.ts:49](src/lib/format.ts:49) — `formatCurrency` — hardcodes
`currency: "CAD"` with no way to override it. Most of the app correctly imports
this one helper, which means most of the app renders every amount with a
Canadian dollar symbol regardless of the actual currency.

This matters because at least one connected Xero organisation banks in **USD**.

Downstream code already knows the helper is wrong and has invented four
different, mutually inconsistent workarounds. The worst is visible to users —
[post-draft-controls.tsx:497](src/components/quickbooks/post-draft-controls.tsx:497)
calls `formatCurrency` and then appends the currency code unconditionally.
Rendered:

| Locale | What a USD transaction shows |
|---|---|
| English | `$1,234.56 USD` |
| French | `1 234,56 $ USD` |

A Canadian-styled dollar sign sitting directly beside a label that contradicts
it. The other three workarounds each disagree: one shows the raw number with no
symbol at all, one labels only the section header and leaves every line CAD, and
one branches on "is this foreign" in a way that still falls through to CAD when
the books' home currency *is* USD.

There are also two byte-identical `money()` helpers in
[xero/post-transaction.ts:467](src/lib/xero/post-transaction.ts:467) and
[quickbooks/post-transaction.ts:104](src/lib/quickbooks/post-transaction.ts:104),
and two identical `formatAmount` functions in `receipt-gap.ts` and
`uncategorized.ts`.

**Fix size:** medium. Add a `currency` parameter to `formatCurrency` (defaulting
to CAD so nothing breaks), then collapse the four workarounds onto it. Do the
parameter first — same shape as Finding 10, where the shared thing has to become
capable before anything can adopt it.

---

## Finding 14 — a comment predicted this exact duplication, and it happened anyway

**Severity: low on its own. High as evidence.**

[avatar-initials.tsx:75](src/components/ui/avatar-initials.tsx:75) exports
`computeInitials`, with this comment directly above it:

> "Exported so surfaces that need the initials WITHOUT this component's chrome
> (the portal's near-black message header renders its own translucent disc) use
> the same derivation rather than a second, drifting copy."

The portal then wrote two copies of it —
[r/[token]/page.tsx:87](src/app/r/[token]/page.tsx:87) and
[portal-shell.tsx:218](src/components/portal/portal-shell.tsx:218). Neither file
imports `computeInitials` (verified: zero occurrences in both). And they drift:

| Firm name | Shared version | Portal copies |
|---|---|---|
| Smith Jones Bookkeeping | `SB` | `SJ` |
| Gagnon Tremblay Associés CPA | `GC` | `GT` |

The shared version takes first-and-last word; the copies take the first two. So
a three-word firm gets different initials in the portal than in the app. The
copies also lose the email handling and the empty-name guard.

**This is the third time in this audit** that a previous session anticipated a
duplication in a comment and the duplication happened regardless — the others
being `normalize.ts` (Finding 1) and `Panel` (Finding 10). All three comments
were accurate, well-written, and completely ineffective.

That is the argument for the rule in `CLAUDE.md`. A note explaining the risk sits
in a file that only gets read by someone already editing it — which is precisely
the person who doesn't need the warning. A rule read at the start of every
session reaches the person who does.

**Fix size:** tiny. Two imports.

---

## Finding 15 — the long tail

Verified, lower priority, listed so they aren't re-discovered:

- **Empty states:** ~13 hand-rolled "nothing here" panels, no shared component.
  Padding, corner radius, border opacity and icon treatment all differ. Nothing
  is *wrong*, it's just visibly inconsistent.
- **Engagement status colour:** the shared `engagementStatusVariant` is
  duplicated locally in two files
  ([engagements/[id]/page.tsx:1863](src/app/[locale]/(app)/engagements/[id]/page.tsx:1863),
  [clients-table.tsx:382](src/components/clients/clients-table.tsx:382)), both of
  which already import a *different* function from that same shared module.
  Outputs agree today. Both copies type the status as a plain string, so
  TypeScript won't flag a missed case when a status is added.
- **Client filter dropdown:** four independent implementations; three offer an
  "all clients" option and one doesn't.
- **Reassign dropdown:** four implementations. Two share a byte-identical button
  style — and one's own docblock says it "mirrors" the other.
- **Date formatting:** two places bypass the shared `formatDate` and lose
  Canadian date conventions — [team-manager.tsx:803](src/components/settings/team/team-manager.tsx:803)
  passes a bare `"fr"` instead of `"fr-CA"`, and
  [file-to-storage-dialog.tsx:183](src/components/filing/file-to-storage-dialog.tsx:183)
  passes no locale at all. The scan flagged that it inferred the visible effect
  from documented behaviour rather than seeing it rendered — worth a look before
  treating the symptom as confirmed, though the code is unambiguously passing a
  different locale than everywhere else.

### Things that are done right, for calibration

Worth recording so this doesn't read as "everything is broken":

- `formatBytes`, `docTypeLabel`, `PaymentBadge`, `StageChip`, `AvatarInitials`,
  `ClientCombobox` and `PaymentsList` are all properly single-sourced and reused.
- The engagements table is *deliberately* shared between the main list and the
  client page, with a comment explaining it was kept unified on purpose:
  "DELIBERATELY NOT A FORK… Copying it would have produced a second table that
  drifts."
- The client row has exactly one implementation.
- The dashboard's "needs attention" row is a separate implementation from the
  main engagement row — but that one is a justified split (different shape for a
  different job) and it already shares the underlying logic. Not a finding.

The codebase clearly knows how to do this. The gap is that doing it is currently
a matter of individual judgement rather than a rule.

---

## Finding 16 — saving the firm name silently switches off auto-reject

**Severity: highest tier. Confirmed by executing the real code, not by reading
it.**

Turning on "Auto-reject unusable documents" (Settings → Documents) and later
editing the firm's name (Settings → Account) **silently switches auto-reject back
off.** No warning, no error, nothing in the interface either before or after.

The chain, each link verified:

1. The firm-details form sends exactly three fields — name, brand colour,
   default language. It has no auto-reject control
   ([firm-settings-sections.tsx](src/components/settings/firm-settings-sections.tsx)).
2. Its validator declares `auto_reject_unusable_docs` with `.default(false)`
   ([settings.schema.ts:25](src/app/actions/settings.schema.ts:25)). A default
   *materialises* the key even when the form never sent it. I ran the real
   schema against the exact three fields the form sends, and the output was:

   ```
   in:  { name, brand_color, locale_default }
   out: { name, brand_color, locale_default, auto_reject_unusable_docs: false }
   ```

3. The action passes that whole object through —
   `updateCurrentFirm(parsed.data)` ([settings.ts:39](src/app/actions/settings.ts:39)).
4. `updateCurrentFirm` writes whatever patch it's handed, and
   `auto_reject_unusable_docs` is in its permitted column list
   ([firms.ts:152](src/lib/db/firms.ts:152)).

Meanwhile the real toggle writes a narrow, correct patch
([auto-reject/route.ts:35](src/app/api/firm/auto-reject/route.ts:35)) — so two
independent writers touch one column and the wrong one wins whenever you edit
your firm name.

**And there is a passing test that certifies it.**
[settings.test.ts:12](src/app/actions/settings.test.ts:12) asserts *"defaults to
false when the field is absent from the form"* — which is exactly the behaviour
that erases the setting. This is the second time in this audit that tests lock in
the defect instead of catching it (Finding 1 was the first).

**Fix size:** one word. Change `.default(false)` to `.optional()`, or drop the
field from that schema entirely since the dedicated route owns it. Then fix the
test to assert the key is *absent*.

---

## Finding 17 — English-speaking clients see no instructions on most checklist items

**Severity: high. Invisible from your side of the product.**

Checklist items store two description columns — `description` (English) and
`description_fr`. There are two separate places an item gets created, and they
fill those columns differently:

| Created how | English column | French column |
|---|---|---|
| As part of a new engagement | **always empty** | filled |
| Later, via "+ Add item" | filled | filled |

The builder seeds `description_en: null`
([engagement-builder.tsx:330](src/components/engagements/engagement-builder.tsx:330))
and its only description box writes solely to the French column (line 1326);
nothing ever assigns the English one. The creation insert then stores
`description: item.description_en ?? null`
([engagements.ts:462](src/lib/db/engagements.ts:462)) — always null. The
"+ Add item" route, by contrast, mirrors one box into both columns
([items/route.ts:72](src/app/api/engagements/[id]/items/route.ts:72)).

The client portal reads
`locale === "fr" && item.description_fr ? item.description_fr : item.description`
([item-card.tsx:300](src/components/portal/item-card.tsx:300)).

So an English-speaking client sees **no instructions at all** on every item that
was part of the original checklist, and does see them on items added afterwards.
You would never notice from inside the app, because the firm-side editor always
shows the French text either way.

**Fix size:** small. Mirror the description into both columns at creation, the
way the add-item route already does — or better, give both paths one shared
"build an item row" function so they can't diverge again.

---

## Finding 18 — things you can set once and never change

Not duplication, but found on the way and worth knowing. These have a creation
path and no edit path at all:

- **Engagement title** — no rename exists anywhere. A typo is permanent unless
  you delete and rebuild the engagement, losing its uploaded files and history.
- **Tax year** — same.
- **AI analysis on/off** — set at creation; the header shows a permanent "AI off"
  badge with nothing to click.
- **A checklist item's description** — settable at creation and at add-time,
  then never editable by anything.

And two capabilities that exist but have no button — the only way to reach them
is to type into the AI assistant chat:

- **Changing an engagement's due date** (`updateEngagementDueDate` — its sole
  caller is the chat tool).
- **Editing an existing checklist item's label, type, or required flag**.

**Fix size:** small-to-medium each. The server-side functions for the last two
already exist and just need a control wired to them.

---

## Finding 19 — your own example turned out to be the thing that's already fixed

**This is the good news, and it's worth ending on.**

Organizers — the feature you named — is **not** duplicated. It is the single
best-built example of the pattern in the whole codebase.

[client-team-editor.tsx](src/components/clients/client-team-editor.tsx) is one
component with two modes: `live` on the client page (every change saves
immediately) and `draft` in the create-client dialog (choices held until you
submit). Both render identical markup. Both funnel into the same
`addClientMemberAction`. Verified: exactly two call sites, one component, one
server action, one table.

Its header comment says why, and it quotes you:

> "Written twice, the two would drift: the create form would quietly lack
> positions, or gain a confirm the panel does not have, and the founder's rule
> that 'everything correlates' would break at exactly the seam nobody looks at."

So your instinct wasn't wrong — it was *right enough that someone already acted
on it for that feature*. You were describing a real thing you'd experienced. It
had simply already been fixed in the one place you happened to name.

That makes `ClientTeamEditor` the reference implementation. When consolidating
anything else in this document, copy its shape: one component, a mode prop for
where it's used, identical markup in both, and a comment saying why.

---

## Recommended order

Reasoning, not a mandate — the founder decides.

**Fix now (real defects, all small):**

1. Finding 16 — firm name wipes auto-reject. One word, plus its test.
2. Finding 17 — English clients see no instructions. Small.
3. Finding 6 — the download audit log. Small, and it's a trust issue.
4. Finding 1 — the four search normalizers. Small.

**Then the enablers (each unblocks other cleanups):**

5. Finding 10 — let `Panel` accept `className`/`id`. Nothing else can adopt it
   until this lands.
6. Finding 13 — give `formatCurrency` a currency parameter. Same shape: the
   shared thing has to become capable before the four workarounds can collapse.

**Then the sweep (needs the founder's eye):**

7. Findings 2, 11, 12 — implement the design tokens, extract `<SettingsSection>`
   and `<SettingRow>`, unify the two firm-settings shells.
8. Finding 7 — the document status pills, once you've picked the canonical set
   of status words.

**Leave alone for now:** Findings 3, 5, 15 — real but low-value, best folded in
opportunistically when touching those files anyway.

## The through-line

Three separate times, a previous session saw a duplication risk and wrote an
accurate, well-argued comment about it — in `normalize.ts`, in `Panel`, and above
`computeInitials`. All three comments were correct. All three were ignored,
because a comment is only read by someone already inside that file, which is
precisely the person who doesn't need the warning.

Twice, a passing test certified the defect rather than catching it — the
normalizers, and the firm-settings default.

That is the whole case for putting this in `CLAUDE.md` instead of in the code:
the rule has to reach the person *before* they start editing, and it has to be
about searching for the other copies, because neither comments nor tests can do
that job.

