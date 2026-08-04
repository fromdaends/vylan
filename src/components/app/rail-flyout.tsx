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

import { useEffect, useRef } from "react";
import { Link } from "@/i18n/navigation";
import { ChevronRight, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type FlyoutItem = {
  href: string;
  label: string;
  /** One line on what is in there. Optional; a row without one just sits shorter. */
  description?: string;
  icon?: LucideIcon;
};

export function RailFlyout({
  open,
  title,
  items,
  activeHref,
  closeLabel,
  autoFocus,
  onClose,
}: {
  open: boolean;
  title: string;
  items: FlyoutItem[];
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

      <div aria-hidden className="mx-4 h-px bg-border" />

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {items.map((item, i) => {
          const active = activeHref === item.href;
          const Icon = item.icon;
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
                "group relative flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                open &&
                  "motion-safe:animate-[rail-flyout-item-in_320ms_cubic-bezier(0.32,0.72,0,1)_both]",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
              {Icon && (
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                    active
                      ? "border-accent/25 bg-accent/10 text-accent"
                      : "border-border/70 bg-background text-muted-foreground group-hover:border-border group-hover:text-foreground",
                  )}
                >
                  <Icon className="size-[17px]" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-[13.5px] leading-tight",
                    active ? "font-semibold" : "font-medium",
                  )}
                >
                  {item.label}
                </span>
                {item.description && (
                  <span className="mt-1 line-clamp-2 text-[11.5px] leading-[1.35] text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
              {/* Arrives on hover only. A chevron parked on every row is a
                  decoration; one that appears under the cursor is an answer to
                  "is this clickable". */}
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:translate-x-0 motion-reduce:transition-opacity"
              />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
