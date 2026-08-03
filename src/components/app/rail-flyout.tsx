"use client";

// A second sidebar, slid out from the icon rail.
//
// The founder's correction, with Canopy's own screenshot attached: "for work it
// has to be an actual sidebar like in the screenshot. NOT a actual page."
//
// The difference is real. A rail item that NAVIGATES commits you before you
// have chosen — you land on Tasks whether you wanted Tasks or Engagements, and
// getting to the other one costs a second click and a page load. A rail item
// that OPENS asks first: here are the rooms in this section, pick one.
//
// It is a panel, not a dropdown, because the rail is a 76px column at the edge
// of the screen and a menu hanging off it would be a floating box in a corner.
// Sliding a second column out reads as "you are still in this section, one
// level deeper", which is exactly what is happening.
//
// The rail's OWN item stays lit while this is open, so it is obvious which
// section you are looking inside.

import { useEffect, useRef } from "react";
import { Link } from "@/i18n/navigation";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type FlyoutItem = { href: string; label: string; description?: string };

export function RailFlyout({
  open,
  title,
  items,
  activeHref,
  closeLabel,
  onClose,
}: {
  open: boolean;
  title: string;
  items: FlyoutItem[];
  /** Which room you are already standing in, so the panel says so. */
  activeHref: string | null;
  closeLabel: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and focus lands inside on open — a panel you can open with
  // the keyboard and not leave with it is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector("a")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Catches the click that means "not this". Transparent rather than a
          dim scrim: the page behind is still your context, and darkening it
          would make a two-item menu feel like a modal decision. */}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="fixed inset-0 z-30 hidden cursor-default sm:block"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        className="fixed inset-y-0 left-[76px] z-40 hidden w-[268px] flex-col border-r border-border bg-card shadow-[8px_0_24px_-12px_rgb(0_0_0_/_0.25)] sm:flex"
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <nav className="flex flex-col px-2 pb-4">
          {items.map((i) => {
            const active = activeHref === i.href;
            return (
              <Link
                key={i.href}
                href={i.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{i.label}</span>
                  {i.description && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {i.description}
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 opacity-50" aria-hidden />
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
