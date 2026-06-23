"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

// One row of the firm-wide QuickBooks drafts queue (Stage 4, Phase 3). The
// compact `summary` (client / engagement / document / amount / status + the
// inline Approve/Dismiss/Reopen controls) is always shown; clicking the chevron
// reveals `children` — the full editable QuickBooks draft card.
//
// The full card's client subcomponents (its searchable pickers + the controls)
// only mount / hydrate when a row is expanded, so a long queue doesn't run dozens
// of pickers at once. (The card's markup is still part of the initial server
// payload — expansion defers the client-side mount, not the download.)
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
    <li className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">{summary}</div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? t("queue_collapse") : t("queue_expand")}
          className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </div>
      {open && (
        <div className="border-t border-border/40 px-3 pb-3 pt-1">
          {children}
        </div>
      )}
    </li>
  );
}
