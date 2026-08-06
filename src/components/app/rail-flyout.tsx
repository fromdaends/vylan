"use client";

// A second sidebar, slid out from the icon rail.
//
// The founder's original correction, with Canopy's own screenshot attached:
// "for work it has to be an actual sidebar like in the screenshot. NOT a actual
// page." A rail item that NAVIGATES commits you before you have chosen — you
// land on Tasks whether you wanted Tasks or Engagements. A rail item that OPENS
// asks first: here are the rooms in this section, pick one.
//
// Then, on seeing the first version live: "it looks HORRIBLE its overlapping
// with the page the text ui looks bad and theres no animation to open it."
// All three were true, and each had exactly one cause:
//
//  1. OVERLAP. It was pinned at a hardcoded left:76px while the rail is 92px
//     (--rail-width), so it sat sixteen pixels UNDER the rail — and the page
//     behind it never moved, so it guillotined the dashboard mid-sentence.
//     It is anchored to --rail-width now, and it PUSHES: the rail sets
//     --rail-flyout-offset, which the shell's content column is margined by.
//     Nothing is ever covered. That is the whole difference between a drawer
//     and a thing lying on top of your work — and it is why there is no scrim
//     and no invisible click-blocker either: the page beside it stays live.
//
//  2. NO ANIMATION. `if (!open) return null` cannot animate. There is no "off"
//     frame to move from — the element simply exists or does not, and a browser
//     has nothing to interpolate between a missing element and a finished one.
//     So it stays MOUNTED and toggles classes instead, which is the same shape
//     the chat launcher panel already uses. `inert` keeps a closed panel out of
//     the tab order and off the accessibility tree, so "still in the DOM" never
//     means "still reachable".
//
//  3. THE TEXT. Two bare words and a chevron in a 250px column is a list with
//     nothing to look at. Every row now carries its own icon and one line
//     saying what is inside, and they arrive in sequence rather than all at
//     once, so the eye is led down the list instead of meeting all of it.
//
// The rail's OWN item stays lit while this is open, so it is obvious which
// section you are looking inside.

// ── AND THEN IT BECAME A POPOVER ───────────────────────────────────────────
//
// Everything above is still true, and the panel below still works — but it is
// no longer what opens. `RailPopover`, at the bottom of this file, is: a small
// box anchored to the tab you clicked rather than a full-height column beside
// the rail.
//
// The reasoning is the design handoff's, and it is about PROPORTION. A section
// menu with four rows in it was being answered with a 272px column running the
// entire height of the screen, which pushed the page sideways to make room for
// something the size of a business card. A menu should be the size of its own
// contents; a sidebar is for things you keep open while you work, and nobody
// keeps "which kind of template?" open.
//
// The panel is kept, wired and reachable behind `panelStyle="panel"` on the
// rail, so this is a switch rather than a demolition — the push-drawer
// behaviour, its offset variable and its staggered rows all still work if the
// founder wants them back.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { ChevronRight, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type FlyoutItem = {
  href: string;
  label: string;
  /** One line on what is in there. Optional; a row without one just sits shorter. */
  description?: string;
};

/** A round icon button in the panel's header strip. Canopy's three-up shortcut
 *  row: the things you reach for most, above the longer list. */
export type FlyoutAction = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export function RailFlyout({
  open,
  title,
  items,
  actions,
  activeHref,
  closeLabel,
  autoFocus,
  onClose,
}: {
  open: boolean;
  title: string;
  items: FlyoutItem[];
  /** Optional round-button strip above the list (Canopy's three-up shortcuts). */
  actions?: FlyoutAction[];
  /** Which room you are already standing in, so the panel says so. */
  activeHref: string | null;
  closeLabel: string;
  /**
   * Whether to move focus into the panel on open. TRUE only when it was opened
   * from the keyboard.
   *
   * Founder, on seeing a blue ring sitting on the first row after a mouse
   * click: "get rid of the blue ring". It was not decoration and not a bug in
   * the ring — it was this panel grabbing focus on open, which is correct for
   * somebody who arrived by keyboard and pure noise for somebody who arrived by
   * mouse. So focus now follows the MODALITY rather than the event: the ring
   * appears exactly for the people it is a wayfinding aid for.
   */
  autoFocus: boolean;
  /**
   * `restoreFocus` asks the rail to put focus back on the button that opened
   * this. Same rule: only on a keyboard close, or the rail item is left wearing
   * a ring after an ordinary click.
   */
  onClose: (opts?: { restoreFocus?: boolean }) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape is keyboard by definition, so focus always goes home from here.
      if (e.key === "Escape") onClose({ restoreFocus: true });
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      // The rail is exempt: clicking a DIFFERENT section while this is open
      // should switch panels, not dismiss and leave you where you were.
      if (target.closest("[data-rail]")) return;
      onClose();
    };
    // Focus lands inside on open — a panel you can open with the keyboard and
    // not leave with it is a trap. (The rail hands focus back on close.) For a
    // mouse user it is skipped entirely: their pointer is already where they
    // want it, and moving focus only paints a ring on a row they did not ask
    // about.
    if (autoFocus) {
      panelRef.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, autoFocus, onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      // Explicitly NOT modal: the page beside it is pushed, not covered, and it
      // stays usable. Announcing it as modal would tell a screen reader the rest
      // of the app had gone away when it plainly has not.
      aria-modal={false}
      aria-label={title}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed inset-y-0 left-[var(--rail-width)] z-40 hidden w-[var(--rail-flyout-width)] flex-col border-r border-border bg-card sm:flex",
        // Enter is slower than exit on purpose: arriving should feel like
        // something unfolding, leaving should feel like getting out of the way.
        // The enter duration matches the content column's own margin transition
        // in app-shell — the panel's right edge and the page's left edge are the
        // same line, and two speeds would tear it.
        "transition-[opacity,transform,box-shadow] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-opacity",
        open
          ? "translate-x-0 opacity-100 shadow-[12px_0_32px_-20px_rgb(0_0_0_/_0.5)] duration-300"
          : // A short slide, not a full-width one: the panel sits ABOVE the rail
            // in the stack, so coming from further out would mean sliding across
            // the navigation on the way in.
            "pointer-events-none opacity-0 shadow-none duration-200 motion-safe:-translate-x-3",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-[18px]">
        <h2 className="min-w-0 truncate text-[17px] font-semibold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          // detail === 0 means the click came from Enter or Space rather than a
          // pointer — the standard way to tell an activated button from a
          // clicked one, and the difference between handing focus back and
          // leaving a ring behind.
          onClick={(e) => onClose({ restoreFocus: e.detail === 0 })}
          aria-label={closeLabel}
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-[15px]" aria-hidden />
        </button>
      </div>

      {actions && actions.length > 0 && (
        // Evenly spread rather than left-packed: with two or three items a
        // left-packed row leaves a hole on the right that reads as a missing
        // fourth button.
        <div className="flex items-start justify-around gap-2 px-3 pb-4 pt-3">
          {actions.map((action) => {
            // Only ever true for a panel whose buttons are DESTINATIONS (Work).
            // The Create panel's are ?new=1 links, which nobody is ever "on".
            const current = activeHref === action.href;
            return (
              <Link
                key={action.href}
                href={action.href}
                onClick={() => onClose()}
                aria-current={current ? "page" : undefined}
                className="group flex w-[84px] flex-col items-center gap-2 rounded-lg py-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground transition-[background-color,box-shadow] group-hover:bg-accent-hover",
                    // A ring rather than a different fill: the buttons are the
                    // panel's brand moment and recolouring one would break the
                    // row. Said twice — a ring for people who can see it, and
                    // aria-current above for people who cannot.
                    current &&
                      "ring-2 ring-accent ring-offset-2 ring-offset-card",
                  )}
                >
                  <action.icon className="size-[21px]" aria-hidden />
                </span>
                <span
                  className={cn(
                    "text-[11.5px] leading-tight text-foreground",
                    current ? "font-semibold" : "font-medium",
                  )}
                >
                  {action.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Only when there is something on BOTH sides of it. A panel that is
          nothing but its button strip (Work) would otherwise end on a rule with
          empty space under it, which reads as a list that failed to load. */}
      {items.length > 0 && (
        <div aria-hidden className="mx-4 h-px bg-border" />
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {items.map((item, i) => {
          const active = activeHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onClose()}
              aria-current={active ? "page" : undefined}
              // The stagger. A CSS ANIMATION rather than a delayed transition,
              // because a transition-delay on the row would also delay its hover
              // colour by the same amount — every row below the first would feel
              // broken to the mouse for a tenth of a second. Adding the
              // animation class on open is what restarts it, so it replays every
              // time rather than only on the first open.
              style={open ? { animationDelay: `${60 + i * 55}ms` } : undefined}
              className={cn(
                "group relative block rounded-lg px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                open &&
                  "motion-safe:animate-[rail-flyout-item-in_320ms_cubic-bezier(0.32,0.72,0,1)_both]",
                active ? "bg-secondary" : "hover:bg-muted",
              )}
            >
              {/* Where you are is said twice, because either half has to survive
                  on its own: a colour for everyone who can see it, and
                  aria-current above for everyone who cannot. */}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent"
                />
              )}
              {/* The LABEL carries the link colour and the chevron sits directly
                  after the words rather than parked at the right edge — that is
                  the whole difference between Canopy's list and a settings menu.
                  The arrow is part of the sentence, not a row ornament, so it is
                  always visible instead of arriving on hover. */}
              <span
                className={cn(
                  "flex items-center gap-1 text-[13.5px] leading-tight text-accent transition-colors group-hover:text-accent-hover",
                  active ? "font-semibold" : "font-medium",
                )}
              >
                <span className="min-w-0 truncate">{item.label}</span>
                <ChevronRight aria-hidden className="size-3.5 shrink-0" />
              </span>
              {item.description && (
                <span className="mt-1 block text-[11.5px] leading-[1.4] text-muted-foreground">
                  {item.description}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE POPOVER — the rail's menus at the size of their own contents.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A small box that expands out of the tab you clicked.
 *
 * Anchored to the trigger's bounding rect rather than to a fixed offset: the
 * rail scrolls (a firm with Bookkeeping on can overflow a short viewport), so
 * a hardcoded top would point the caret at the wrong tab the moment anybody
 * scrolled it. Clamped to the viewport for the same reason — a popover opened
 * from the last tab on a short screen would otherwise hang off the bottom.
 */
export function RailPopover({
  open,
  title,
  kicker,
  items,
  actions,
  activeHref,
  anchorTop,
  autoFocus,
  onClose,
}: {
  open: boolean;
  title: string;
  /** Small uppercase line above the quick actions. The Create popover's only. */
  kicker?: string;
  items: FlyoutItem[];
  /** The boxed round-icon shortcuts, side by side above the rows. */
  actions?: FlyoutAction[];
  activeHref: string | null;
  /** Viewport Y of the trigger's top edge, from its bounding rect. */
  anchorTop: number;
  autoFocus: boolean;
  onClose: (opts?: { restoreFocus?: boolean }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Both in STATE, not read off the ref at render time. The clamp and the
  // caret need a height the box does not have until it has been laid out once,
  // and reading a ref during render is how you get a value from the previous
  // open — or, on the first one, nothing at all.
  const [box, setBox] = useState({ top: anchorTop, height: 0 });

  // useLayoutEffect rather than useEffect so the correction lands before the
  // browser paints — with the async version an over-hanging popover visibly
  // jumps up after you have already seen it in the wrong place.
  useLayoutEffect(() => {
    if (!open) return;
    const height = ref.current?.offsetHeight ?? 0;
    const max = Math.max(8, window.innerHeight - height - 8);
    setBox({ top: Math.min(Math.max(8, anchorTop), max), height });
  }, [open, anchorTop, items.length, actions?.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape is keyboard by definition, so focus always goes home from here.
      if (e.key === "Escape") onClose({ restoreFocus: true });
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target)) return;
      // The rail is exempt, so clicking a DIFFERENT section switches popovers
      // instead of merely dismissing this one. This is why there is no
      // click-blocking backdrop: a backdrop would swallow that first click and
      // make switching sections take two.
      if (target.closest("[data-rail]")) return;
      onClose();
    };
    if (autoFocus) {
      ref.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, autoFocus, onClose]);

  if (!open) return null;

  // Where the caret sits on the popover's own left edge — chased back to the
  // trigger after any clamping, so it keeps pointing at the tab that opened it
  // rather than at whatever happens to be beside it.
  // 200 is the pre-measurement fallback: the first frame is drawn before the
  // layout effect has run, and a caret pinned to 14 would visibly slide down
  // on the second. A rough middle is invisible; a jump is not.
  const caretTop = Math.min(
    Math.max(14, anchorTop - box.top + 18),
    (box.height || 200) - 24,
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      style={{
        top: box.top,
        // The box grows OUT of the tab: the origin is the caret, not the
        // corner, which is the difference between expanding and sliding.
        transformOrigin: `0 ${caretTop}px`,
        width: actions && actions.length > 0 ? 296 : 288,
      }}
      className="wizard-popover fixed left-[100px] z-[45] hidden rounded-xl border border-border bg-card p-1.5 sm:block"
    >
      <span
        aria-hidden
        className="absolute -left-[5.5px] size-2.5 rotate-45 border-b border-l border-border bg-card"
        style={{ top: caretTop - 6 }}
      />

      {kicker && (
        <p className="mx-2.5 mt-1 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {kicker}
        </p>
      )}

      {actions && actions.length > 0 && (
        <>
          <div className="flex gap-1.5 px-2 pb-2.5">
            {actions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                onClick={() => onClose()}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-[10px] border border-border py-2.5 transition-colors hover:border-accent/50 hover:bg-accent-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-[34px] place-items-center rounded-full bg-accent-subtle text-accent">
                  <action.icon className="size-4" aria-hidden />
                </span>
                <span className="text-[11.5px] font-[550]">{action.label}</span>
              </Link>
            ))}
          </div>
          <div aria-hidden className="mx-2 mb-1 h-px bg-border/70" />
        </>
      )}

      {items.map((item) => {
        const active = activeHref === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => onClose()}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group block rounded-lg px-2.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-accent-subtle" : "hover:bg-muted",
            )}
          >
            {/* ── THE LABEL IS THE LINK, AND IT LOOKS LIKE ONE ──────────
                Founder, comparing the popover against the panel it replaced:
                "make the writing the same colour as before, that blue instead
                of plain."

                Right, and the chevron comes back with it. The blue and the
                arrow-after-the-words are Canopy's own list — the arrow is part
                of the sentence rather than an ornament parked at the right
                edge, which is why it is always visible instead of arriving on
                hover. The popover borrowed the panel's shape and lost its one
                piece of vocabulary on the way.

                Where you are is still said twice — a heavier weight for
                everyone who can see it, aria-current above for everyone who
                cannot. Colour cannot carry it here, because every row is
                already blue. */}
            <span
              className={cn(
                "flex items-center gap-1 text-[13px] leading-tight text-accent transition-colors group-hover:text-accent-hover",
                active ? "font-semibold" : "font-[550]",
              )}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              <ChevronRight aria-hidden className="size-3.5 shrink-0" />
            </span>
            {item.description && (
              <span className="mt-px block text-[11px] leading-snug text-muted-foreground">
                {item.description}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
