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
