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
| A3 | `support.getcanopy.com/en/articles/12573386` — *How do I create a Task Template* | Task template fields, recurrence scheduler (beta) |
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
| 12 | **A task template carries its client request** | *in flight* | Per A2: copied at edit time, not referenced |

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

### 6. Standalone task-template editing
Today a task template can be created and removed but not EDITED. Canopy's A2
flow starts with *Options icon → Edit* on an existing task template. Until that
exists, changing one means deleting and rebuilding it.

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

## Naming — one open question for the founder

Canopy's word vs Vylan's, for the same object:

| Canopy | Vylan today |
|---|---|
| Engagement Item | Service |
| Client Request | Document request |

The Templates flyout says "Client request". The page's own section headings
still say "Document requests" and "Services". Renaming the headings is a
visible change to a daily-use page, so it is the founder's call.

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
