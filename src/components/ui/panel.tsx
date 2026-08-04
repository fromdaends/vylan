import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// A titled section box — the unit the whole app's detail pages are built from.
//
// Canopy's client page is these and nothing else: a bordered card, a quiet
// uppercase title band, and whatever controls belong to THAT section sitting in
// the band beside the title. It is what makes a dense page readable instead of
// a wall, and it is why a section's own controls never end up in the page
// header pretending to be page-level.
//
// Extracted because the client page and the teammate profile had grown their
// own byte-identical copies, and a third page was about to. They had drifted
// only in the name of the right-hand slot — `action` on one, `aside` on the
// other — so both are kept: `action` for something you DO here (a button, a
// "View all" link), `aside` for something that describes or filters this
// section. They render in the same place; the distinction is for the reader.
//
// A plain server-safe module: no state, no "use client", so a Server Component
// can render it and nothing crosses the RSC boundary.
export function Panel({
  title,
  action,
  aside,
  flush = false,
  className,
  children,
}: {
  title: string;
  /** Something you DO in this section — a button, a "View all" link. */
  action?: ReactNode;
  /** Something that describes or filters this section — counts, a filter row. */
  aside?: ReactNode;
  /** Body sits flush to the border — for tables that draw their own padding. */
  flush?: boolean;
  /** Grid placement / sizing from the caller. A panel does not decide where it
   * sits on a page, so the page passes that in rather than the panel guessing. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-card",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {title}
        </h2>
        {/* One slot, two names. A section that has both puts its description
            first and its action last, which is the order they read in. */}
        {(aside || action) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {aside}
            {action}
          </div>
        )}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}
