"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  WorklistTable,
  type WorklistRow,
} from "@/components/dashboard/engagements-worklist";
import {
  selectActive,
  selectCompleted,
} from "@/lib/dashboard/worklist-select";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";

const STATUS = ["active", "completed", "all"] as const;
type StatusFilter = (typeof STATUS)[number];

// The full "Browse all" engagements list, behind /engagements. Reuses the
// dashboard's WorklistTable. A status filter splits Active (default, the live
// work) / Completed (finished — where engagements land once marked complete) /
// All (everything, incl. cancelled). Search spans every status. Newest first.
export function AllEngagements({
  rows,
  locale,
}: {
  rows: WorklistRow[];
  locale: AppLocale;
}) {
  const t = useTranslations("Dashboard");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    // Search spans every status (find any engagement); otherwise the status
    // filter governs.
    const base =
      q !== ""
        ? rows.filter(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.clientName.toLowerCase().includes(q),
          )
        : status === "active"
          ? selectActive(rows)
          : status === "completed"
            ? selectCompleted(rows)
            : rows;
    return [...base].sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
  }, [rows, status, q]);

  const statusLabel = (s: StatusFilter): string =>
    s === "active"
      ? t("wl_status_active")
      : s === "completed"
        ? t("wl_status_completed")
        : t("wl_status_all");

  const emptyText =
    q !== ""
      ? t("wl_empty_search")
      : status === "completed"
        ? t("wl_empty_completed")
        : status === "active"
          ? t("wl_empty_active")
          : t("wl_empty_all");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label={t("wl_filter_label")}
          className="inline-flex items-center gap-1 self-start overflow-x-auto rounded-lg bg-muted p-[3px]"
        >
          {STATUS.map((s) => {
            const active = s === status;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(s)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-foreground/60 hover:text-foreground",
                )}
              >
                {statusLabel(s)}
              </button>
            );
          })}
        </div>

        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("wl_search_placeholder")}
            aria-label={t("wl_search_placeholder")}
            className="h-9 pl-9"
          />
        </div>
      </div>

      <WorklistTable rows={visible} locale={locale} emptyText={emptyText} />
    </div>
  );
}
