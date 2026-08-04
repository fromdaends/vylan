"use client";

// The Create Engagement shell — Canopy's chrome, Vylan's colours.
//
// Founder: "I want to replicate the exact way of creating an engagement with
// the same look feel and everything all around", and then, when asked: "yes do
// it everything but keep my own colours."
//
// So the STRUCTURE is copied precisely — a titled bar across the top with the
// actions in it, a dimmed backdrop, one card holding the whole thing — and the
// palette is Vylan's. A literal white panel would have made this one screen
// stop matching the rest of the app.
//
// WHY THE ACTIONS MOVED UP HERE. On the old page they were a footer under the
// form, which meant on a long step (Reminders, Billing) you had to scroll past
// everything you had just filled in to find Save. Canopy puts Save and Preview
// in the bar, always visible, and that is the better half of their design
// rather than merely the more familiar one.
//
// NOT A ROUTE MODAL. It looks like a modal and keeps its own URL, so the page
// is still linkable, refreshable and back-buttonable. Intercepting routes would
// have bought a genuine overlay at the cost of a much more fragile flow, and
// nothing in the founder's ask depends on the page behind it staying rendered.

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
   * Narrow the sheet. The opening question needs a fraction of the builder's
   * width, and Canopy's own flow reflects that — a compact dialog first, the
   * wide modal only after you answer it. At full width the question sits in
   * roughly 800px of empty sheet, which reads as a page that failed to load.
   */
  compact = false,
  /**
   * Float over the page behind it, blurring what is there.
   *
   * Founder: "it should be an overlap and maybe blur the background of what the
   * screen was originally on... a box that appears overlapping over the UI that
   * already exists." That needs the previous page to still be MOUNTED, which is
   * what the @modal intercepting route provides — a normal navigation replaces
   * the page and leaves nothing behind to blur.
   *
   * False on a direct load or refresh, where there genuinely is nothing behind
   * and a panel floating over blankness would be worse than a full page.
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
   * There is nothing to save before you have answered it, and an enabled
   * button that does nothing is worse than no button — the same reason
   * Canopy's Preview and Accept are not drawn here yet.
   */
  onSaveDraft?: () => void;
  onSaveAndSend?: () => void;
  /**
   * Absent while the start chooser is showing — there is nothing to save yet,
   * and an enabled Save above an unanswered question is a trap.
   */
  onSaveAsTemplate?: () => void;
  compact?: boolean;
  overlay?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "w-full animate-in-fade px-4 pb-14 pt-5 sm:px-6 lg:px-8",
        overlay &&
          // Covers the app's own content column, not the whole viewport: the
          // icon rail stays live and un-dimmed, which is how Canopy's modal
          // behaves and what keeps this feeling like part of the app rather
          // than a takeover.
          //
          // backdrop-blur needs something translucent OVER it to read at all —
          // a bare blur on a near-black page is invisible. The wash does that
          // work; the blur softens whatever colour is underneath.
          "fixed inset-0 z-40 overflow-y-auto bg-background/70 backdrop-blur-sm sm:left-[var(--rail-width)]",
      )}
    >
      <div
        className={cn(
          "mx-auto flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated",
          compact ? "max-w-2xl" : "max-w-[1400px]",
          // LIGHTER than the page, not merely bordered. Measured on the live
          // site, the app background is pure black and `bg-card` is oklch 0.14
          // — near enough identical that the sheet read as another region of
          // the page rather than something laid on top of it.
          //
          // A dimming backdrop, which is how Canopy separates its modal, does
          // nothing here: you cannot darken black. On a dark theme the only
          // move available is to RAISE the surface, which is what
          // --surface-elevated (oklch 0.175) exists for. The cards inside stay
          // on --card and therefore read as inset panels, which is the correct
          // hierarchy rather than an accident.
          "shadow-[0_24px_60px_-30px_rgb(0_0_0_/_0.55)]",
        )}
      >
        {/* ── The bar ─────────────────────────────────────────────────────
            Title left, actions right, exactly Canopy's arrangement. It does
            not scroll away: on a long step the actions have to stay reachable,
            which was the whole problem with the footer they replace. */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3.5">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>

          <div className="flex shrink-0 items-center gap-2">
            {/* Split control: the primary action is one click, the alternative
                is one more. Canopy's Save ▾ opens onto "Save and send" and
                "Save as draft", and sending is the common ending. */}
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
                    draft / Save and send, and templates are only built from
                    scratch under Templates. The founder asked for it anyway:
                    "Create the save as template button why not. 1 step at a
                    time getting better than canopy". Separated by a rule
                    because it saves a SHAPE rather than this engagement. */}
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

        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
