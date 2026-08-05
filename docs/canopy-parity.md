# Canopy parity — templates & engagement creation

**The one place that tracks everything the founder has asked for on this.** Every
item says where it came from, so nothing is built on a spec somebody remembered
rather than read.

Update this in the SAME session as the work. A stale checklist is worse than
none — see `feedback_keep-roadmap-artifact-live`.

---

## Sources of truth

| # | Source | What it settles |
|---|---|---|
| A1 | `support.getcanopy.com/en/articles/10263111` — *How do I create an Engagement Template* | The four builder tabs, Introduction fields, the live preview, Save draft vs Save template |
| A2 | `support.getcanopy.com/en/articles/9375953` — *Add Client Request Templates to Task Templates* | A client request is attached from INSIDE a task template; "Apply template" COPIES the fields |
| A3 | `support.getcanopy.com/en/articles/12573386` — *How do I create a Task Template (New Recurrence Scheduler Beta)* | Task template fields, recurrence. **A legacy twin exists** at `.../9376001-...-legacy-recurrence-scheduler`; same builder, different recurrence section |
| S1 | Founder screenshots of Canopy's **Create Engagement Template** modal | Tab chrome, the red ⓘ required marker, the eye/preview toggle, exact empty-state copy |
| S2 | Founder screenshot of Canopy's **Templates flyout** | Eleven template types in a plain row list, no button strip |

**Verbatim founder decisions** (do not re-litigate):

- *"i want to replicate the exact way of creating an engagement with the same look feel and everything all around"* — then *"yes do it everything but keep my own colours."*
- *"these things were implementing would then have to corelate directly to the actual workflow within vylan"* — parity is not cosmetic; it has to drive real Vylan data.
- *"within canopy an engagement is not purely defined by document requested checklist items. Its abundant amount of tasks and things to do"*
- *"there shouldn't be a preset, like, documents section when creating an engagement… It exists within that task."*
- *"you wouldnt be building a duplicate builder. you would simply be changing the existing one."* — **the template builder is a `mode` prop on `EngagementBuilder`.** Never a second component.
- *"there should be a sidebar that opens much like the + button one"* — Templates rail item OPENS, does not navigate.
- The **proposal document comes LAST** (it is generated from everything else). **Terms is parked with it.**
- *"1 step at a time getting better than canopy lol"* — Save-as-template was built although Canopy has no equivalent.

---

## Shipped

| # | What | PR | Notes |
|---|---|---|---|
| 1 | Priced engagement items | #1274 / 1450 | Feeds the invoice |
| 2 | Service catalogue | 1480 | Canopy's "Engagement Item" |
| 3 | Engagement templates (save a whole job) | 1500 | Team / Private, RLS-enforced |
| 4 | Dynamic placeholders in the engagement name | #1326 | `{{clientname}}` etc. |
| 5 | Start date + intro message | 1510 | Canopy step-1 fields |
| 6 | Agreement status replaces the stage cascade | — | |
| 7 | **Documents becomes a task, not a step** | #1336 | Wizard is now details → services → tasks → billing → reminders |
| 8 | **Engagement templates visible on the Templates page** | #1339 | Were readable from ONE place; now listed, removable, usable |
| 9 | **Task templates** | #1343 / 1570 | Applied + verified live |
| 10 | **Templates opens a flyout** | #1345 | Four rows; reuses `RailFlyout` |
| 11 | **Apply a task template in the Tasks step** | #1345 | Downgrades a clashing one-per-engagement kind and says so |
| 12 | **A task template carries its client request** | #1347 | Per A2: copied at edit time, not referenced |
| 13 | **One Templates page per type** | #1350 | `/templates` redirects; the sidebar is the divider |
| 14 | **Task templates take Canopy's parent shape** | #1351 | One parent + steps, not N siblings |
| 15 | **Every engagement is a proposal** | 1660 | Not only template-derived ones — the founder's call |
| 16 | **Client-facing proposal viewer** | 1640 / 1650 | Accept marks it active and starts the work |
| 17 | **ONE builder chrome for every template type** | — | `TemplateBuilderShell`: title bar, tabs, preview, Back/Next |
| 18 | **Task templates get their own route** | — | `/templates/tasks/new` + `/<id>`; the inline card is gone |
| 19 | **Services get their own route** | — | `/templates/services/new` + `/<id>`; the modal dialog is gone |
| 20 | **A template carries the work its services imply** | — | `taskTemplateIds` on the payload; the engagement seeds its tasks from it |
| 21 | **The proposal shows what each service buys** | — | The task steps under the priced line |
| 22 | **Engagement creation gets a Proposal step** | — | Terms, period, signers and deposit are editable per engagement |
| 23 | **Tasks start EMPTY on a from-scratch engagement** | #1388 | The seeded document-request row is gone; a template still brings its own |
| 24 | **"Engagement items" renamed "Service items"** | #1388 | Founder's call — one word per concept across the workflow |
| 25 | **An empty service catalogue says so** | #1388 | The link picker used to render nothing, so the feature read as missing |
| 26 | **Document request builder: padding, entry route, no more blanks** | #1387 | Its `<h1>` sat at `top: 0`; `?new=1` minted a blank on every arrival |

---

## Not built yet

Ordered by founder emphasis × how self-contained it is.

### 1. `mode: "engagement" \| "template"` on `EngagementBuilder`
The founder's explicit instruction. In template mode: a Template Details card
(name + Team/Private) at the top of step 1, placeholders instead of a real
client, and **Save template** instead of Create. Everything else is the same
component. Source: S1, A1.

### 2. Tab chrome across the top
Canopy: `Introduction · Services · Terms · Signatures`, a red ⓘ on a tab whose
required fields are missing (tooltip names the field), and an eye icon that
hides the preview. Vylan has a LEFT RAIL of five steps today. Decide whether
tabs replace the rail or sit above it — **ask the founder**, it is a visible
change to a screen they use daily. Source: S1.

### 3. The live preview pane
The right half of Canopy's builder renders the client-facing engagement as it
is configured, with its own 4-step progress (`1 Introduction · 2 Services ·
3 Terms · 4 Sign`) and real empty-state copy:
> "No introductory items / Your introductory message, video, and/or documents will appear here"
> "No Services / To include service terms, return to the previous step and add your services."

Reads state Vylan already holds: title, client, `serviceItems`, `items`,
`tasks`, `introMessage`, `startDate`. Source: S1, A1.

### 4. Engagement period
`Engagement period begins on`: **Acceptance** | **Custom date**.
`Engagement period`: dropdown (Custom / Ongoing / 1, 3, 12 months).
Needs a migration — `engagements.period_months` + `period_starts_on`. Source: A1.

### 5. The three Introduction toggles
Draggable rows, each with a toggle: **Welcome Message** (can autofill from a
letter template), **Video** (YouTube/Vimeo/Zoom link), **Document** (internal
file or PDF upload). Vylan has `intro_message` (plain text, 1510) which covers
the first only. Source: A1, S1.

### 5b. Known divergences from Canopy — deliberate, and worth a decision

These are places where Vylan's shape is **not** Canopy's. None is an accident;
each needs a founder call before it is "fixed".

**Task template structure — RESOLVED, now matches Canopy (#1351).** Vylan's task
template is ONE PARENT TASK with steps and a client request under it, written as
`engagement_tasks` rows linked by `parent_id`. It was briefly a flat list of
siblings; the founder chose Canopy's shape. Templates saved flat upgrade on
read. Still missing from the parent, versus Canopy: roles, task tags, budgeted
hours, return type, a Dates section, automations, file/reminder tools.

**Who can edit a shared template.** Canopy: *"All users can access shared task
templates, but only admins or the template creator can edit them."* Vylan's RLS
on `task_templates` lets anyone in the firm edit a `team` one — copied from
`engagement_templates` (1500), where that rule was deliberate. If the founder
wants Canopy's stricter rule, it is a policy change on the update/delete
policies, not a code change.

**When a template is applied.** Canopy applies a task template only at task
CREATION (Create Task modal → Template → Apply); there is no documented way to
apply one to an existing task. Vylan applies it in the engagement builder's
Tasks step, which is a superset — worth keeping.

**Fields Vylan's task template does not carry:** roles, task tags, budgeted
hours, return type, dates (fixed / relative / custom), automations, file and
reminder tools. Several have no Vylan counterpart at all yet.

**Recurrence.** A3 exists in two live versions — a *New Recurrence Scheduler
(Beta)* and a *Legacy* one — describing the same builder with different
recurrence sections. A recurring Canopy template stays LINKED to the task it
created, locks most fields, pushes future edits into future instances, and can
be unlinked exactly once. Vylan has recurring ENGAGEMENTS (0770/0890) but
nothing equivalent on tasks. **Do not build against the beta article without
asking** — a beta is a moving target.

### 6. ~~Standalone task-template editing~~ — SHIPPED
`/templates/tasks/<id>` is the same builder that creates one, seeded. Clicking a
row opens it, which is the founder's rule: viewing and editing are one thing.

### 7. Recurrence on task templates
A3 documents a recurrence scheduler (beta). Not started; confirm it is wanted
before building — a beta feature is a moving target.

---

## Parked by founder decision

- **Terms tab** — with the proposal.
- **Signatures / deposit** — with the proposal.
- **The proposal document, Preview, and client accept** — last, generated from
  everything above.
- **Packages** ("Mark as best value") — not raised by the founder; Canopy has it.

---

## Deliberately NOT built

Canopy's Templates flyout lists eleven types. Vylan has four. The other seven —
Folder, Email, Letter, eSign, Client Record, Boilerplate Letter Text, Client
Portal Invitation, Resolution Case — have no counterpart, and a row that opens
nothing is worse than a shorter list. Revisit only when the underlying feature
exists.

---

## The one builder NOT converted — stated out loud

The founder: "ALL THE UIS FOR BUILDING EVERYTHING TEMPLATES SHOULD ALL BE THE
SAME. STOP BUILDING INCONSISTENT THINGS."

Three of the four now share `TemplateBuilderShell` — engagement templates, task
templates and services. The **document-request template detail page**
(`template-detail-shell.tsx`) does NOT, and that is a deliberate hold rather
than an oversight:

- Its layout is the founder's OWN sketch — a boxed sidebar with Documents ·
  Automation · Tasks · Assignees — asked for by name and built to it.
- It is not only an authoring screen. It carries the workflow editor, the
  copy-on-use save-back to a firm automation, and a read-only mode for
  built-ins with "Clone to customize".

Converting it is a small job (its four sections map onto tabs) but it changes a
layout the founder chose personally, so it needs their word first. **Ask before
converting.** Everything else that authors a template already shares the frame.

---

## Naming — DECIDED for the line, still open for the catalogue

The founder, 2026-08-05: *"On the engagement creation for the engagement items
tab. Are they the same as Service items? If so re label engagement items to
service items so the naming is consistent throughout the workflow."*

They are the same. An engagement item is a priced line that may point at a
catalogue entry (`engagement_items.service_id`), which is what Canopy calls a
Service Item. Two words for one concept inside one workflow.

| Canopy | Vylan now |
|---|---|
| Engagement Item | **Service item** (the line, on an engagement) |
| Engagement Item | "Service templates" (the catalogue page) — **STILL OPEN** |
| Client Request | Document request |

**Done:** the wizard step, the section heading and the field label on engagement
creation all say "Service item" now. The `engagement_items` table keeps its
name — that is storage, not vocabulary.

**Open:** `/templates/services` is still titled "Service templates". Renaming a
daily-use page is the founder's call, and it was not part of the sentence above.
Ask before changing it.

---

## Traps that have already bitten this work

1. **One-per-engagement kinds.** `document_collection`, `signatures`,
   `deliverables` are unique per engagement (1370's partial index) *and tasks
   are written fail-soft* — a refused insert is logged and swallowed. Anything
   that adds tasks must go through `availableKinds()` /
   `appendTemplateTasks()` in `src/lib/engagements/task-drafts.ts`.
2. **Never-wired props.** Three merged features sat inert because one scripted
   edit had a single assertion. Grep every wiring point separately.
3. **i18n keys fail silently** — a wrong key renders `Namespace.key` on screen
   and passes tsc, eslint and the build.
4. **`tsc --noEmit` last**, after every file — `next build` does not typecheck
   test files.
5. **Duplicate keys inside one namespace** parse fine and silently override.
   Check before committing `messages/*.json`.

---

## THE PROPOSAL *IS* THE ENGAGEMENT LETTER — researched, verified, decided

The founder asked: *"isnt the proposal whats supposed to be signed at the begginign
and then the engagement letter covers everything within that contract"* and then
*"you tell me whats the best thing to do. I dont know whats like normal for
something like this look it up."*

**Answer: ONE document.** Four competitors and the professional standards all agree,
and every quote below was re-fetched and confirmed at its source by a second agent
prompted to refute it. Two fabricated quotes were caught and discarded in that pass —
which is exactly why it ran.

| Source | Verdict | Verbatim |
|---|---|---|
| **Canopy** | one | "Engagements align client communication, services, billing, and signatures in one document." · client docs say "Click on the proposal **or** engagement to begin" — same object, two words |
| **Ignition** | one | "your engagement letter or contract terms form part of your proposal" |
| **TaxDome** | one | object is literally named "Proposals & ELs"; "The Terms page is where you provide your engagement letter or contract" |
| **Karbon** | one | one Engagement record with a field called "Agreement Text" |
| **CAS/ISA 210, AR-C 80** | one | terms must be recorded in "an engagement letter **or other suitable form of written agreement**" |

**The standards line is the one that settles it.** The requirement is CONTENT IN
WRITING BEFORE WORK STARTS, not a document with a particular name. A signed proposal
containing the required content IS the engagement letter, professionally. "Proposal"
appears zero times as a document name in any standard.

Two further findings that affect the build:
- **Fees are OPTIONAL** in all three standards — so the "hide prices from the client"
  visibility switches break nothing legally.
- **A signature is not uniformly required** — the standards require written agreement,
  not universally a signature.

### What happens to migration 1580 (the uploaded PDF)

**It stays. Nothing shipped breaks.** It stops being a SEPARATE thing the client signs
and becomes one of two ways to fill the proposal's Terms section — type them, or
attach the firm's PDF, which rides at the back of the one proposal. Ignition does
exactly this: "any additional documents will be attached to your client's proposal
PDF in one file."

The automated send stays live-armed and becomes the fallback for a firm that has not
built a proposal yet. The only thing discarded is the idea of a second signature,
which was never shipped.

⚠️ This still needs the OTHER SESSION's coordination — 1580 is theirs and is
live-armed for ZT & Associates.

### ⚠️ WHAT THE RESEARCH COULD NOT ESTABLISH — do not build on an invented spec

No vendor documents ANY of these. Each is a Vylan decision, to be made deliberately:

1. **Whether terms are frozen at signing.** Extend the repo's copy-on-use rule, but
   know you are deciding it, not following anyone.
2. **Firm countersignature.** No vendor documents one. US compilation standards want
   both sides to sign; the Canadian one clearly requires only the client. The existing
   optional toggle is right *because* nobody knows.
3. **Client declines.** No vendor documents a declined state. It must be invented.
4. **Bilingual / province-specific terms.** None of the four handle it. Vylan's
   one-letter-per-language design is AHEAD of all of them — no precedent to copy.
5. **Amending mid-engagement or re-signing next year.** Undocumented everywhere.
6. **Ignition's "automatically convert to an engagement letter"** is MARKETING COPY
   only — no help article describes it. Do NOT build a status change on it.
7. **Canopy's own tab names are inconsistent** between two of their articles
   (Introduction/Services/Terms/Signatures vs Introduction/Signers/Terms/Signatures).
   Ours matches one version; do not treat it as a verified spec.
8. **Review engagements** were NOT verified as requiring a letter in Canada — only
   compilations are confirmed. Do not say otherwise in marketing.

---

## ACCEPTANCE — the missing step, and Karbon's lifecycle as the reference

Found while researching the proposal question: **nothing in Vylan can mark an
engagement accepted.** The only `accepted_at` in the codebase belongs to TEAM
INVITES. `resolveAgreementStatus` models `accepted` and nothing can reach it.
And sending an engagement today immediately emails the client the DOCUMENT
REQUEST — there is no proposal and no agreement in between.

The founder found the same hole from the other end: *"you send out the proposal.
They agree, sign, then you create the engagement with them, which then prompts
them to upload the documents."* That is the correct order. Vylan does
create → send → "upload your documents", skipping the agreement entirely.

### Karbon's lifecycle, from their own Engagements overview

Worth copying — it is the most completely documented of the four, and it
independently confirms the one-document answer: *"**Agreement Text**: Include
your firm's comprehensive terms and conditions, scope of work, and any
disclaimers **directly within the engagement document**."*

`Draft → Waiting for acceptance → Accepted → Active → Ended`

| Action | Available in | What it does |
|---|---|---|
| **Send to client** | Draft | Goes to the **signatories** (plural). Requires ≥1 signatory and all required fields. |
| **Resend** | Waiting for acceptance | Fresh signing link, no status or content change. |
| **Accept on behalf** | Draft | Marks accepted with NO signature — for agreement obtained verbally or on paper. |
| **Revert to Draft** | Waiting / Accepted | **The only way to edit after sending.** Withdraws from signatories, unlinks work, clears generated content. |
| **Activate** | Accepted | Accepted → Active, "signalling that work can begin". Billing starts. Requires ≥1 service. |
| **End** | Active | Historical record, no longer modifiable. |

⚠️ **ACCEPTED AND ACTIVE ARE TWO DIFFERENT STATES IN KARBON.** Signing does not
start the work; a human activates it. Vylan's `resolveAgreementStatus` already
distinguishes them — that turns out to match Karbon exactly, which is
reassuring, but Vylan's version derives `active` from client activity rather
than an explicit action. Worth a founder decision.

⚠️ **"Revert to Draft" is the answer to "how do you edit a sent proposal".**
Vylan has no answer today. Karbon's is deliberately destructive and says so.

⚠️ **"Accept on behalf" is the escape hatch every firm needs** — the client
agreed on the phone. Vylan has nothing like it, and without it a firm cannot
get an engagement moving when a client will not use the portal.

### Still unestablished (from the earlier research pass)

No vendor documents: whether terms freeze at signing · a firm countersignature ·
a client-DECLINED state · bilingual/province terms · amending mid-engagement.
Karbon's "Accept on behalf" is a bypass, NOT a countersignature.
