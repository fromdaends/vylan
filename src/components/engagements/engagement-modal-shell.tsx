"use client";

// The Create Engagement shell — Canopy's chrome, Vylan's colours.
//
// Founder: "I want to replicate the exact way of creating an engagement with
// the same look feel and everything all around", then "yes do it everything but
// keep my own colours." So the STRUCTURE is copied and the palette is not.
//
// Three defects were reported against earlier versions of this file, and all
// three came from the same mistake — treating the shell as a page that happens
// to look like a dialog, instead of as a dialog.
//
//  1. "its extremly laggy... cant even X out of the screen".
//     backdrop-filter is recomputed every frame the element MOVES, and the blur
//     was on the same element that scrolled — so the page behind it was
//     re-blurred continuously. This repo has been bitten by exactly this before
//     (screenshots hang on the engagement detail route for the same reason).
//     The backdrop is now its own static layer: it never moves, so it paints
//     once.
//
//  2. "if you look its still off center".
//     The container started after the rail, so centring inside it pushed the
//     box right by half the rail's width. The container now spans the whole
//     viewport and is pointer-events-none, so the box centres on the SCREEN
//     while the rail underneath stays clickable. The backdrop still stops at
//     the rail, so the rail is never dimmed.
//
//  3. "every time u click to the next step the box changes size and shape...
//     it should be consistent throughout the entire engagement creating
//     process".
//     The box was sized by its contents, so every step resized it — and the
//     opening question had its own narrower width on top of that. It is now ONE
//     fixed width and height for the whole flow, with the body scrolling
//     inside. That is what a dialog is, and why Canopy's never moves either.

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

export function EngagementModalShell({
  title,
  closeHref,
  labels,
  onSaveDraft,
  onSaveAndSend,
  onSaveAsTemplate,
  /**
   * Float over the page behind, blurring it.
   *
   * False on a direct load or refresh, where there is genuinely nothing behind
   * and a panel over blankness would be worse than a page.
   */
  overlay = false,
  busy = false,
  children,
}: {
  title: string;
  /** Where the ✕ goes. The list you most likely came from. */
  closeHref: string;
  labels: {
    close: string;
    save: string;
    saveDraft: string;
    saveAndSend: string;
    saveAsTemplate: string;
    saving: string;
  };
  /**
   * Both absent on the opening question, which hides the Save control entirely.
   * There is nothing to save before you have answered it, and an enabled button
   * that does nothing is worse than no button.
   */
  onSaveDraft?: () => void;
  onSaveAndSend?: () => void;
  onSaveAsTemplate?: () => void;
  overlay?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // ONE size for every step. Not min/max — fixed, so the box cannot breathe as
  // you move from a two-card question to a fourteen-card template grid. Capped
  // against the viewport so it never overflows a laptop screen.
  const sheet = cn(
    "flex w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated",
    // LIGHTER than the page, not merely bordered. Measured on the live site,
    // the app background is pure black and bg-card is oklch 0.14 — near enough
    // identical that the sheet read as another region of the page. A dimming
    // backdrop cannot fix that (you cannot darken black); on a dark theme the
    // only move is to RAISE the surface, which --surface-elevated is for.
    "shadow-[0_24px_60px_-30px_rgb(0_0_0_/_0.55)]",
    overlay ? "pointer-events-auto h-[min(86vh,54rem)]" : "min-h-[38rem]",
  );

  return (
    <>
      {/* The backdrop, as its OWN static layer — see note 1 at the top. Stops
          at the rail so the rail stays live and un-dimmed. */}
      {overlay && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm sm:left-[var(--rail-width)]"
        />
      )}

      <div
        className={cn(
          "animate-in-fade",
          overlay
            ? // Full viewport so the box centres on the SCREEN.
              // pointer-events-none lets clicks reach the rail; the sheet takes
              // its own back.
              "pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
            : "w-full px-4 pb-14 pt-5 sm:px-6 lg:px-8",
        )}
      >
        <div className={overlay ? sheet : cn(sheet, "mx-auto")}>
          {/* ── The bar ───────────────────────────────────────────────────
              Title left, actions right, exactly Canopy's arrangement. It never
              scrolls away: on a long step the actions have to stay reachable,
              which was the whole problem with the footer they replaced. */}
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3.5">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
              {title}
            </h1>

            <div className="flex shrink-0 items-center gap-2">
              {/* Split control: the primary action is one click, the
                  alternative is one more. Sending is the common ending. */}
              {onSaveDraft && onSaveAndSend && (
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" disabled={busy} className="gap-1.5">
                      {busy ? labels.saving : labels.save}
                      <ChevronDown className="size-3.5" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => onSaveAndSend()}>
                      {labels.saveAndSend}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onSaveDraft()}>
                      {labels.saveDraft}
                    </DropdownMenuItem>
                    {/* Canopy does NOT have this — their flow ends at Save as
                        draft / Save and send. The founder asked for it anyway:
                        "1 step at a time getting better than canopy". Under a
                        rule because it saves a SHAPE, not this engagement. */}
                    {onSaveAsTemplate && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onSaveAsTemplate()}>
                          {labels.saveAsTemplate}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <Link
                href={closeHref}
                aria-label={labels.close}
                title={labels.close}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-[18px]" aria-hidden />
              </Link>
            </div>
          </div>

          {/* The BODY scrolls, not the sheet. That is what keeps the box the
              same size on every step and the bar always reachable. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
