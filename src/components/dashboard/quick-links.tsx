"use client";

// Quick links (design 2a) — the quiet hairline list under the agenda card.
// No card chrome on purpose: these are shortcuts, not content.
//
// Editable in place, compactly, per the founder's standing preference for
// per-item controls over bulk modes: a ghost "+" beside the heading opens a
// two-field row; each link grows a small remove button on hover. Everyone in
// the firm may edit — the links are a shared shelf, not a setting (1390).

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FirmLink } from "@/lib/db/firm-links";
import {
  addFirmLinkAction,
  deleteFirmLinkAction,
  type FirmLinkActionResult,
} from "@/app/actions/firm-links";

export function QuickLinks({ links }: { links: FirmLink[] }) {
  const t = useTranslations("Dashboard");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function report(res: FirmLinkActionResult): boolean {
    if (res.ok) {
      startTransition(() => router.refresh());
      return true;
    }
    toast.error(
      res.needsMigration
        ? t("quicklinks_needs_migration")
        : res.error === "bad_url"
          ? t("quicklinks_bad_url")
          : t("quicklinks_failed"),
    );
    return false;
  }

  async function add() {
    if (!label.trim() || !url.trim() || busy) return;
    setBusy(true);
    try {
      if (report(await addFirmLinkAction({ label, url }))) {
        setLabel("");
        setUrl("");
        setAdding(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      report(await deleteFirmLinkAction({ id }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-1">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t("quicklinks_title")}
        </h2>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          aria-label={t(adding ? "quicklinks_cancel" : "quicklinks_add")}
          className="flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {adding ? (
            <X className="size-3.5" aria-hidden />
          ) : (
            <Plus className="size-3.5" aria-hidden />
          )}
        </button>
      </div>

      <div className="mt-2 flex flex-col">
        {links.length === 0 && !adding && (
          <p className="py-2 text-xs text-muted-foreground">
            {t("quicklinks_empty")}
          </p>
        )}

        {links.map((link, i) => (
          <div
            key={link.id}
            className={cn(
              "group flex items-center gap-2.5 px-1 py-[9px] text-[13.5px]",
              i < links.length - 1 && "border-b border-border/60",
            )}
          >
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate transition-colors hover:text-accent"
            >
              {link.label}
            </a>
            <button
              type="button"
              onClick={() => remove(link.id)}
              disabled={busy}
              aria-label={t("quicklinks_remove", { label: link.label })}
              className="flex size-5 flex-none items-center justify-center rounded text-muted-foreground opacity-0 transition-[color,opacity] hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X className="size-3" aria-hidden />
            </button>
            <ExternalLink
              className="size-[13px] flex-none text-muted-foreground"
              aria-hidden
            />
          </div>
        ))}

        {adding && (
          <div className="flex flex-col gap-1.5 border-t border-border/60 px-1 py-2">
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("quicklinks_label_placeholder")}
              aria-label={t("quicklinks_label_placeholder")}
              className="h-8 rounded-md border border-border bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-1.5">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder={t("quicklinks_url_placeholder")}
                aria-label={t("quicklinks_url_placeholder")}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={add}
                disabled={!label.trim() || !url.trim() || busy}
                aria-label={t("quicklinks_save")}
                className="flex size-8 flex-none items-center justify-center rounded-md bg-secondary text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Check className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
