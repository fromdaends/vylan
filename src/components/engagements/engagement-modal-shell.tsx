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
import { EngagementsListSkeleton } from "@/components/engagements/engagements-list-skeleton";

export function EngagementModalShell({
  title,
  closeHref,
  labels,
  onSaveDraft,
  onSaveAndSend,
  onSaveAsTemplate,
  busy = false,
  flushBody = false,
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
  busy?: boolean;
  /**
   * The child draws its own scrolling regions, so the body must NOT scroll or
   * pad — it just has to be a flex column that fills the sheet.
   *
   * Engagement creation uses this: BuilderChrome puts a tab rail at the top, a
   * Back/Next footer at the bottom and scrolls only the middle, exactly like
   * every template builder. Wrapping that in a padded scroller would give the
   * sheet two scrollbars and float the footer.
   */
  flushBody?: boolean;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // ONE size for every step. Not min/max — fixed, so the box cannot breathe as
  // you move from a two-card question to a fourteen-card template grid. Capped
  // against the viewport so it never overflows a laptop screen.
  const sheet = cn(
    // `relative` is load-bearing, not decoration.
    //
    // CSS paints POSITIONED elements (even at z-index:auto) in a later layer
    // than non-positioned ones. The dim beside it is `absolute`; this sheet was
    // static. So the dim painted ON TOP of the dialog no matter what order they
    // appeared in the DOM — the whole thing washed out grey, which is what the
    // founder saw four times and I misread three times as a blur problem.
    //
    // Positioning the sheet puts both in the same painting step, where DOM
    // order decides — and the sheet comes last.
    // `relative z-10` is load-bearing, not decoration: it is the ONLY thing
    // keeping the dim behind the dialog rather than over it.
    "relative z-10 flex w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated",
    "pointer-events-auto h-[min(86vh,54rem)]",
    // LIGHTER than the page, not merely bordered. The app background is pure
    // black and bg-card is oklch 0.14 — near enough identical that the sheet
    // read as another region of the page. On a dark theme the only move is to
    // RAISE the surface, which --surface-elevated is for.
    "shadow-[0_24px_60px_-30px_rgb(0_0_0_/_0.55)]",
  );

  return (
    <>
      {/* A STATIC field, not a live page.
          
          Founder, after three rounds of symptoms: "maybe just create the
          thought... it looks like it's overlapping over real UI, but it's not,
          in the sense that it's just like a screenshot of it. And it's actually
          a new screen... because the screen behind it shouldn't be able to
          move. I think that's the source of all the issues."
          
          Exactly right, and it was. This used to be a Next intercepting route
          that kept the page you came from MOUNTED underneath — which meant two
          live React trees, a backdrop-filter over a scrolling tree, and a ✕
          that could not decide whether it closed a dialog or navigated a page.
          All three symptoms had that one cause.
          
          It is a plain page again. It LOOKS overlaid and nothing behind it is
          real, so nothing behind it can move, repaint, or steal a click. */}
      {/* ── THE GLASS, AND AN EXPLICIT ORDER ───────────────────────────
          The founder, five times: the frosted glass is not working.

          Every previous attempt left the paint order IMPLIED — by z-index
          across separate fixed layers, then by DOM order, then by making the
          sheet positioned. Each was correct in theory and none of them held,
          and the symptom was always the same: the DIALOG came out grey, which
          only ever happens when the dim is painting on top of it.

          So nothing is implied any more. The scenery and its dim are ONE
          element at `z-0`; the sheet is at `z-10`. Two positioned siblings with
          explicit, different z-indexes in the same parent have exactly one
          possible order, and no ancestor can change it.

          ── WHAT IS BEHIND THE GLASS ────────────────────────────────────

          The SHAPE of the engagements list and nothing else: no data, no client
          components, no hydration, no scrolling, no animation. Scenery — closer
          to a photograph of the page than to the page, which is what the
          founder asked for and what keeps it free.

          The blur is a plain `filter` on the scenery, not a `backdrop-filter`
          pane: backdrop-filter samples a "backdrop root" whose membership
          depends on the same stacking rules that kept breaking this. */}
      {/* NO `animate-in-fade` on this container, and that is the whole fix.
          Proven in the live page: stripping that one class makes the dialog
          snap crisp and the frosted glass appear behind it. With it, the sheet
          rendered grey and washed out no matter how the layers underneath were
          ordered — which is why five attempts at the layering changed nothing.

          `main` already fades the page in, so this was a second fade over the
          first; once the scenery and its dim moved INSIDE this container, that
          compositing is what flattened the dialog into them. */}
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <div
          aria-hidden
          // `inert` as well as pointer-events-none: nothing in here may take
          // focus from the dialog, including via the keyboard.
          inert
          className="absolute inset-0 z-0 select-none overflow-hidden sm:left-[var(--rail-width)]"
        >
          {/* blur-md is filter: blur(12px) on this element's own content.
              scale-105 hides the soft transparent edge a blur leaves behind. */}
          <div className="scale-105 px-6 pt-7 blur-md lg:px-11">
            <EngagementsListSkeleton animated={false} tone="contrast" />
          </div>
          {/* The dim, inside the same element as the scenery it dims — so the
              two can never be separated by a stacking rule again. */}
          {/* Light dim. The BLUR is what separates the dialog from the page;
              the dim only takes the edge off. Heavier values washed the scenery
              back out to nothing, which is the bug this kept shipping. */}
          <div className="absolute inset-0 bg-background/20 dark:bg-background/30" />
        </div>

        <div className={sheet}>
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
              same size on every step and the bar always reachable — unless the
              child scrolls its own middle, in which case it takes the whole
              body and does it itself. */}
          <div
            className={cn(
              "min-h-0 flex-1",
              flushBody
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto p-5 sm:p-6",
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
