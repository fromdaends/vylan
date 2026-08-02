"use client";

// The bar that appears once you tick rows on a bookkeeping list.
//
// It FLOATS over the page rather than sitting under the table, and that is the
// whole point of this file. Both bookkeeping lists previously put their action
// in normal flow below the last row — which works on a five-row list and
// disappears entirely on a real one. Ticking the third of eighteen expenses put
// the only button roughly a thousand pixels below the fold, so the screen
// answered a deliberate click with nothing visible happening at all.
//
// Copied from BulkAssignBar (#1082), which already solved this on the
// engagements list and carries the reasoning: float rather than push, so ticking
// a row never reflows the row you are ticking; and mount only when something is
// selected, so no toolbar sits parked over an untouched list.

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  /** The action itself — a picker, a button, or a warning when there is no
   *  engagement to act on. */
  children: React.ReactNode;
}) {
  const t = useTranslations("Quickbooks");
  if (count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[min(100%,46rem)] flex-wrap items-center gap-3 rounded-full border border-border bg-popover/95 py-2 pl-4 pr-2 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80">
        <span className="font-medium tabular-nums">
          {t("sel_selected", { count })}
        </span>
        {children}
        <button
          type="button"
          onClick={onClear}
          aria-label={t("sel_clear")}
          title={t("sel_clear")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
