"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { QUEUE_COLUMN_COUNT } from "@/lib/quickbooks/draft-queue";

// One row of the firm-wide bookkeeping queue. The server renders `summary` as
// this row's <td> cells; the chevron reveals `children` — the full editable
// draft card — in a second row spanning the whole table.
//
// It used to be a bordered, rounded <li> card. Inside the page's Canopy panel
// that made three nested boxes (panel > list > row), which is what read as
// noise; the panel is the box now, so a row is just a row with a hairline
// under it.
//
// The full card's client subcomponents (its searchable pickers + controls)
// only mount when a row is expanded, so a long queue doesn't run dozens of
// pickers at once. (The markup is still in the initial server payload —
// expansion defers the client-side mount, not the download.)
//
// `group` is what lets the actions cell stay hidden until hover. Deliberately
// NOT a full-row stretched link: those break inside <tr> in Safari, which is
// the founder's browser.
export function QueueRowDisclosure({
  summary,
  children,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("Quickbooks");
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className={cn(
          "group border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40",
          open && "bg-muted/30",
        )}
      >
        {summary}
        <td className="py-2 pr-2 pl-0 align-middle">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? t("queue_collapse") : t("queue_expand")}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn("size-4 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/40 last:border-0">
          <td colSpan={QUEUE_COLUMN_COUNT} className="p-0">
            <div className="bg-muted/20 px-3 py-3">{children}</div>
          </td>
        </tr>
      )}
    </>
  );
}
