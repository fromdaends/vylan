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
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              onClick={() => onClose()}
              className="group flex w-[84px] flex-col items-center gap-2 rounded-lg py-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors group-hover:bg-accent-hover">
                <action.icon className="size-[21px]" aria-hidden />
              </span>
              <span className="text-[11.5px] font-medium leading-tight text-foreground">
                {action.label}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div aria-hidden className="mx-4 h-px bg-border" />

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
