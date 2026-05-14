# Relai Design System

Reference vibe: **Stripe + Linear**. Apple-grade restraint where it pays
off (marketing, hero, modals), but kept dense and information-first
where accountants actually live (tables, lists, dashboards). Animation
is polish, never decoration. Everything respects `prefers-reduced-motion`.

The design language signals: **calm, professional, trustworthy, fast**.
No marketing-y gradients, no glow effects, no decorative orbs in-app.

---

## 1. Typography

### Font stack

- **Primary:** Inter (variable, already loaded via `next/font`)
- **Mono:** JetBrains Mono (already loaded) — used **only** for numbers,
  dates, IDs, dollar amounts. Never for body copy.
- Why Inter: works flawlessly in FR + EN, neutral, financial-software-coded.

### Type scale

| Token | Size (rem / px) | Line height | Tracking | Use |
|---|---|---|---|---|
| `text-display` | 4.5rem / 72px (mobile: 3rem / 48px) | 1.05 | -0.02em | Landing hero only |
| `text-h1` | 1.875rem / 30px | 1.2 | -0.01em | Page titles |
| `text-h2` | 1.25rem / 20px | 1.3 | -0.005em | Section headers in-app |
| `text-h3` | 1rem / 16px | 1.4 | 0 | Card titles, subsections |
| `text-body` | 0.875rem / 14px | 1.55 | 0 | Default body |
| `text-body-lg` | 1rem / 16px | 1.55 | 0 | Marketing body |
| `text-caption` | 0.75rem / 12px | 1.45 | 0 | Metadata, helper text |
| `text-eyebrow` | 0.75rem / 12px | 1 | 0.08em UPPERCASE | Section labels |
| `text-mono` | 0.875rem / 14px JetBrains | 1.4 | 0 | Numbers, IDs, dates |

### Weights

- 400 (regular) — body
- 500 (medium) — buttons, labels, table headers
- 600 (semibold) — headings, emphasis
- No 700/800/900. Heavy weights read as marketing.

---

## 2. Color

oklch throughout (already in use in `globals.css`). Hex equivalents
shown for reference only.

### Neutral ramp — light mode

| Token | oklch | Hex approx | Use |
|---|---|---|---|
| `neutral-0` | `oklch(1 0 0)` | `#FFFFFF` | Card surface |
| `neutral-50` | `oklch(0.985 0.002 264)` | `#FAFAFB` | Page background |
| `neutral-100` | `oklch(0.97 0.004 264)` | `#F4F4F6` | Hover background |
| `neutral-200` | `oklch(0.93 0.006 264)` | `#E5E6EA` | Borders, dividers |
| `neutral-300` | `oklch(0.86 0.008 264)` | `#CFD1D6` | Input borders, disabled |
| `neutral-400` | `oklch(0.7 0.012 264)` | `#A0A3AB` | Placeholder, icons |
| `neutral-500` | `oklch(0.55 0.016 264)` | `#73767E` | Muted text |
| `neutral-600` | `oklch(0.42 0.018 264)` | `#54575E` | Secondary text |
| `neutral-700` | `oklch(0.3 0.02 264)` | `#3A3D44` | Body text |
| `neutral-800` | `oklch(0.22 0.022 264)` | `#252830` | Headings |
| `neutral-900` | `oklch(0.15 0.018 264)` | `#16181E` | Ink |

### Accent

**Indigo, slightly desaturated.** Picked because:
- Distinct from generic fintech blue (Bank of America blue, etc.)
- Calm, doesn't compete with semantic colors
- Already in the existing palette (refined)
- Works in dark mode without becoming washed out

| Token | oklch | Hex approx | Use |
|---|---|---|---|
| `accent` | `oklch(0.5 0.17 270)` | `#4F46E5` | Primary CTAs, links, focus rings |
| `accent-hover` | `oklch(0.44 0.18 270)` | `#3D34CC` | Hover state |
| `accent-soft` | `oklch(0.96 0.025 270)` | `#EEEDFB` | Subtle backgrounds, badges |

### Semantic

| Token | oklch | Hex approx | Use |
|---|---|---|---|
| `success` | `oklch(0.55 0.13 155)` | `#1E9D5F` | Confirmed, approved, paid |
| `success-soft` | `oklch(0.95 0.03 155)` | `#E2F6EB` | Success badge bg |
| `warning` | `oklch(0.72 0.16 75)` | `#D89A2C` | Overdue, attention needed |
| `warning-soft` | `oklch(0.96 0.04 75)` | `#FBF1DD` | Warning badge bg |
| `danger` | `oklch(0.55 0.22 27)` | `#D8453B` | Errors, destructive actions, AI-rejected |
| `danger-soft` | `oklch(0.96 0.03 27)` | `#FBE6E4` | Error message bg |
| `info` | `oklch(0.6 0.1 230)` | `#3F8FB8` | Info notices (different hue from accent so they don't conflict) |
| `info-soft` | `oklch(0.96 0.02 230)` | `#E4F0F6` | Info badge bg |

### Dark mode

Inverted neutral ramp + slightly brighter accent (oklch lightness 0.65
instead of 0.5) so it remains visible against dark backgrounds. Already
wired through `next-themes` and the `.dark` selector in `globals.css`.

### Hard rules

- **Never** use raw hex in components. Always use Tailwind tokens
  resolved from CSS variables.
- **Never** use the accent for warnings/errors/success states. Semantic
  meaning > visual variety.
- **One accent on screen at a time.** If two competing CTAs exist,
  demote one to secondary.

---

## 3. Spacing & layout

### Scale (4px base, matches Tailwind defaults)

`0, 1 (4), 2 (8), 3 (12), 4 (16), 5 (20), 6 (24), 8 (32), 10 (40), 12 (48), 16 (64), 20 (80), 24 (96), 32 (128)`

### Section padding

- Landing sections: `py-24 sm:py-32` (96–128px vertical)
- In-app pages: `py-8` content, no separate section padding (sections are cards)
- Card interior: `p-5` (20px) for medium cards, `p-6` (24px) for larger ones

### Container max-widths

- Landing: `max-w-6xl` (1152px), centered, `px-6` gutter
- App pages: `max-w-7xl` (1280px), `px-4 sm:px-6` gutter
- Modals: `max-w-md` to `max-w-lg`
- Long-form content (settings, profile): `max-w-2xl`

### Grid

- Marketing feature grids: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, `gap-6` to `gap-8`
- Dashboard metrics: `grid-cols-2 sm:grid-cols-5 gap-3`
- Forms: single column, `space-y-4`

---

## 4. Radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 4px | Small badges, tag chips |
| `radius-md` | 6px | Buttons, inputs, small cards |
| `radius-lg` | 8px | Cards, table containers |
| `radius-xl` | 12px | Modals, popovers, large surfaces |
| `radius-full` | 9999px | Avatars, pills, switches |

**No `radius-2xl` or larger.** Pillow-shaped corners read consumer-app,
not financial-software.

---

## 5. Shadows

Cool-tinted (slight blue undertone) so they integrate with the neutral
ramp instead of reading as flat gray. Four levels only.

| Token | Spec | Use |
|---|---|---|
| `shadow-1` | `0 1px 2px 0 oklch(0.2 0.02 264 / 0.04)` | Subtle elevation (card hover) |
| `shadow-2` | `0 1px 3px 0 oklch(0.2 0.02 264 / 0.06), 0 2px 6px -2px oklch(0.2 0.02 264 / 0.04)` | Cards, dropdowns |
| `shadow-3` | `0 4px 12px -2px oklch(0.2 0.02 264 / 0.08), 0 6px 16px -6px oklch(0.2 0.02 264 / 0.06)` | Popovers, hover state on cards |
| `shadow-4` | `0 12px 32px -8px oklch(0.2 0.02 264 / 0.16), 0 24px 56px -16px oklch(0.2 0.02 264 / 0.12)` | Modals, sheets |

In dark mode, shadows shift to pure black with higher opacity (because
slate-on-slate shadows are invisible).

---

## 6. Motion

### Durations

- **Instant feedback** (button press, hover): 100–150ms
- **Standard transition** (toggle, panel open, fade-in): 200ms
- **Larger reveal** (section reveal on scroll, modal in): 350ms
- **Never** > 400ms.

### Easing

- **Default:** `cubic-bezier(0.2, 0.8, 0.2, 1)` (ease-out, slight overshoot-free spring feel)
- For exits: `cubic-bezier(0.4, 0, 1, 1)` (ease-in)
- **Never** use linear except for indeterminate progress.

### What animates

- **Opacity** (0 → 1 / 1 → 0)
- **Transform: translateY** (max 8px for reveal, 4px for hover lift)
- **Transform: scale** (only for press feedback: 0.98 on active)
- **Backdrop blur** (modal overlay only)

### What does NOT animate

- No parallax
- No scroll-jacking, no scroll-snap on the landing page
- No spinning loaders > 1.2s rotation (only for genuine indeterminate)
- No bouncing, no shake, no pulse
- No autoplay video on first paint
- No animated gradients
- No rotating elements as decoration

### Reveal on scroll

- `IntersectionObserver` with `threshold: 0.15`, `rootMargin: "0px 0px -10% 0px"`
- Trigger once, then unobserve
- Animate: `opacity 0 → 1` + `translateY(12px → 0)` over 350ms
- **Reduce motion**: skip the transform, instant opacity 1

### Reduced motion

Wrap every motion utility in `@media (prefers-reduced-motion: no-preference)`.
Default state must be the **end state** of the animation, so users with
reduced motion see the final layout immediately.

---

## 7. Component patterns

### Nav (landing + in-app)

**Landing:**
- Sticky, h-14 (56px)
- Background `bg-neutral-0/85 backdrop-blur-md`
- Border-bottom: `1px solid neutral-200` only when scrolled (else transparent)
- Left: logo + wordmark
- Right: locale toggle, theme toggle, sign in (ghost), sign up (primary)
- Mobile: collapses to logo + hamburger, opens a Sheet

**In-app (`AppShell`):**
- Same structure but with primary nav items (Dashboard, Clients, Templates, Billing)
- Active item: `bg-neutral-100 text-neutral-900`
- Inactive: `text-neutral-500 hover:text-neutral-900`
- Avatar dropdown on the right

### Hero (landing only)

```
┌──────────────────────────────────────────┐
│                                          │
│         [eyebrow label]                  │
│                                          │
│    Display-sized headline                │
│    that takes ~2 lines.                  │
│                                          │
│    Subhead in muted text, 18px,          │
│    max-width 560px.                      │
│                                          │
│    [Primary CTA]  [Secondary]            │
│                                          │
│         [tiny trust line]                │
│                                          │
└──────────────────────────────────────────┘
```

- `py-24 sm:py-32`
- Center-aligned, max-w-3xl for text
- One primary CTA, one secondary (ghost-outline)
- No imagery in the hero itself; a product screenshot goes BELOW the hero

### Feature section

- Eyebrow (uppercase, tracked, muted)
- H2 title, left-aligned (max-w-2xl)
- Lead sentence (body-lg, muted)
- Below: 3-column grid of feature cards (each card = icon, title, 1-2 line description)
- Cards: borderless, just `gap-8`, icon in `neutral-700`, no background
- 3-5 sections total on the landing, separated by `py-24`

### Card (in-app)

- `bg-neutral-0` (`neutral-900` in dark)
- `border-1 border-neutral-200`
- `radius-lg`
- `p-5` standard / `p-6` for spacious
- Optional header: title (text-h3) + count chip on the right
- No shadow at rest
- Hover (when clickable): `border-neutral-300`, `shadow-1`, transform `translateY(-1px)` over 200ms

### Table

```
┌──────────────────────────────────────────────────────┐
│ NAME              TYPE   ENG   EMAIL          ACTIONS│ ← header row
├──────────────────────────────────────────────────────┤
│ Acme Inc.         Biz    3     hi@acme.com    [⋯]    │
│ Pierre Gagnon     Indv   1     —              [⋯]    │
└──────────────────────────────────────────────────────┘
```

- Container: `card` styling (border + radius-lg)
- Header row: `bg-neutral-50`, text-eyebrow (uppercase, tracked, 12px), `text-neutral-500`, `h-10`
- Body row: `h-14` (56px), border-top of `neutral-100` between rows
- Hover: row gets `bg-neutral-50`
- First cell: gets a 4px left padding boost, often holds an avatar + name
- Last cell: action menu (`MoreHorizontal` icon button)
- Numbers / amounts / dates: `font-mono tabular-nums`
- Sort indicators: small chevron in the header, no full re-render flash

### Table row states

- **Loading:** skeleton rows (3 of them), same height as real rows
- **Empty:** see empty state, embedded in the table card
- **Error:** inline alert above the table, retry button

### Empty state

```
       [muted icon, 32px]
       
       No clients yet
       Add your first client to get started.
       
            [Primary CTA]
```

- Vertically centered in available space
- Icon: `text-neutral-300`, 32–40px
- Title: text-h3, `text-neutral-700`
- Body: text-body, `text-neutral-500`
- Optional single CTA below
- `py-12 px-6 text-center`

### Modal

- Backdrop: `bg-neutral-900/40 backdrop-blur-sm`
- Surface: `bg-neutral-0 radius-xl shadow-4 max-w-md`
- Padding: `p-6`
- Header: title (text-h2) + close (X) button, separated `space-y-1`
- Body: `mt-4 space-y-4`
- Footer: `mt-6 flex justify-end gap-2`, secondary action left of primary
- Open animation: opacity 0 → 1 + scale 0.97 → 1 over 200ms
- Close: reverse

### Button hierarchy

| Variant | Use | Spec |
|---|---|---|
| `primary` | The one main action on a screen | bg `neutral-900` (or `accent` for marketing/CTA), text `neutral-0` |
| `secondary` | Co-equal action next to primary | bg `neutral-0`, border `neutral-200`, text `neutral-700` |
| `ghost` | Nav, low-priority actions | no bg, no border, text `neutral-700`, hover `bg-neutral-100` |
| `destructive` | Delete, cancel, irreversible | bg `danger`, text `neutral-0` |
| `link` | Inline text actions | text `accent`, underline on hover only |

**Sizes:**
- `sm`: h-8 (32px), `px-3 text-body`
- `md`: h-9 (36px), `px-4 text-body` (default)
- `lg`: h-11 (44px), `px-6 text-body-lg`

**Press feedback:** scale 0.98 + 100ms ease-in, no shadow change.

### Form input

- Height: `h-9` (sm) / `h-10` (md, default) / `h-11` (lg)
- Border: `1px solid neutral-300`
- Radius: `md`
- Padding: `px-3` (sm) / `px-3.5` (md)
- Background: `neutral-0`
- Placeholder: `text-neutral-400`
- **Focus:** `border-accent`, `ring-2 ring-accent/20`, no scale change
- **Error:** `border-danger`, helper text in `text-danger`
- **Disabled:** `bg-neutral-100`, `text-neutral-400`, cursor-not-allowed

Labels above inputs, `text-caption font-medium text-neutral-700`,
margin-bottom 1.5 (6px). Helper/error text below input, `text-caption`,
matching color.

---

## 8. Iconography

- Library: **lucide-react** (already in use)
- Size: 16px default in body, 20px in section headers, 14px in caption
- Color: inherit from text; `text-neutral-500` for decorative icons,
  `text-neutral-700` for icon-with-label
- Stroke width: 1.5 (lucide default)
- **Never** mix icon libraries. **Never** use emoji as UI icons.

---

## 9. Accessibility (non-negotiable)

- Color contrast: WCAG AA minimum for body text (4.5:1), AAA for body
  on white. The neutral ramp is built to meet this.
- Focus rings: always visible on keyboard nav. `ring-2 ring-accent/40
  ring-offset-2`.
- Touch targets: 44×44px minimum on mobile (button h-11 = 44px).
- Form labels: every input has an associated `<label>` (use `for` /
  `htmlFor`, not just placeholder).
- Heading hierarchy: one `<h1>` per page, no skipping levels.
- Alt text on meaningful images. `aria-hidden` on decorative SVG.
- Skip-to-content link on the landing (one-off).
- All animation respects `prefers-reduced-motion`.

---

## 10. Implementation plan

### Tokens layer

- Refine `src/app/globals.css`: keep oklch + CSS variable structure,
  swap palette to spec above. Map to Tailwind 4's `@theme` block so
  `bg-accent`, `text-neutral-500`, etc., resolve from variables.
- Add `--shadow-1` through `--shadow-4` as CSS variables.
- Define motion variables: `--ease-out`, `--ease-in`, `--duration-fast`,
  `--duration-base`, `--duration-slow`.

### Utility classes (one tiny CSS file)

Create `src/app/animations.css` with three utilities:
- `.reveal` — sets up the IntersectionObserver hook (or use a tiny
  client component `<Reveal>` wrapper that adds the class on intersect)
- `.press` — scale 0.98 on active
- `.lift` — translateY(-1px) on hover

All wrapped in `@media (prefers-reduced-motion: no-preference)`.

### Components layer

Refine the existing shadcn components in `src/components/ui/` —
button, badge, card, dialog, input — to match the new spec. Don't
delete or rename; only tighten the styling.

### Surfaces layer

Rebuild the four target pages on top of the new system, in this order:
1. Landing (Step 3)
2. Dashboard, Templates, Clients (Step 4, after explicit go)

---

## 11. What I will NOT do without asking

- Add `framer-motion` for animation. Native CSS + `IntersectionObserver`
  is enough for the motion specified above.
- Add `react-intersection-observer` (just write the 20-line hook).
- Add any other dependency.
- Touch the routing layer, the i18n setup, the auth flow, the API
  routes, or the AI pipeline.
- Rename or delete the helper CSS classes (`animate-in-up`, `reveal-soft`,
  etc.) — I'll wind them down by moving callers to the new utilities,
  then delete the orphans in a final cleanup pass once everything is
  green.
