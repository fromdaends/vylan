"use client";

import { Children, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Search, BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { formatCurrency, type AppLocale } from "@/lib/format";
import {
  QUEUE_FILTERS,
  type QueueFilter,
  type QueueCounts,
} from "@/lib/quickbooks/draft-queue";
import { ApproveReadyButton } from "./approve-ready-button";

// Firm-wide QuickBooks drafts queue (Stage 4, Phase 3) — the client shell.
// Status + client filters round-trip via the URL (server re-filters + re-renders
// the rows). Text search is an instant client-side filter over the rows already
// rendered, matched against a parallel `searchIndex` (same order as `children`).
export function DraftsQueue({
  counts,
  readyCount,
  totalCad,
  hasForeignCurrency,
  activeFilter,
  activeClient,
  clients,
  locale,
  searchIndex,
  emptyAll,
  children,
}: {
  counts: QueueCounts;
  // Ready drafts matching the active client filter — drives "Approve all ready".
  readyCount: number;
  totalCad: number | null;
  hasForeignCurrency: boolean;
  activeFilter: QueueFilter;
  activeClient: string | null;
  clients: { id: string; name: string }[];
  locale: AppLocale;
  // Parallel to `children` — { id, lowercased searchable text } per row.
  searchIndex: { id: string; text: string }[];
  // True when the firm has zero drafts at all (vs. zero matching the filter).
  emptyAll: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search?.toString() ?? "");
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  // Filter children by the instant text search (children order == searchIndex).
  const childArray = useMemo(() => Children.toArray(children), [children]);
  const q = query.trim().toLowerCase();
  const visible = q
    ? childArray.filter((_, i) => searchIndex[i]?.text.includes(q))
    : childArray;

  const filterLabel: Record<QueueFilter, string> = {
    all: t("queue_filter_all"),
    needs_input: t("bucket_needs_input"),
    ready: t("bucket_ready"),
    approved: t("status_approved"),
    posted: t("status_posted"),
    dismissed: t("status_dismissed"),
  };
  const filterCount: Record<QueueFilter, number> = {
    all: counts.needs_input + counts.ready + counts.approved,
    needs_input: counts.needs_input,
    ready: counts.ready,
    approved: counts.approved,
    posted: counts.posted,
    dismissed: counts.dismissed,
  };

  return (
    <div className="space-y-4">
      {/* Roll-up strip — count + running total (the page header already names
          it, so no repeated label here). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">
          {t("summary_drafts", { count: counts.total })}
        </span>
        {totalCad != null && (
          <span className="ml-auto tabular-nums text-muted-foreground">
            {t("summary_total", { amount: formatCurrency(totalCad, locale) })}
            {hasForeignCurrency ? " +" : ""}
          </span>
        )}
      </div>

      {/* Toolbar: status chips + client filter + instant search. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t("queue_filter_label")}
          className="inline-flex items-center gap-1.5 overflow-x-auto"
        >
          {QUEUE_FILTERS.map((f) => {
            const active = activeFilter === f;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParam("status", f === "all" ? null : f)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {filterLabel[f]}
                <span className="ml-1 tabular-nums text-muted-foreground/70">
                  {filterCount[f]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ApproveReadyButton readyCount={readyCount} client={activeClient} />
          {clients.length > 0 && (
            <Select
              value={activeClient ?? "all"}
              onValueChange={(v) => setParam("client", v === "all" ? null : v)}
            >
              <SelectTrigger
                size="sm"
                className="w-[12rem]"
                aria-label={t("queue_client_label")}
              >
                <SelectValue placeholder={t("queue_client_label")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("queue_client_all")}</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              placeholder={t("queue_search_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 w-full sm:w-64"
              aria-label={t("queue_search_label")}
            />
          </div>
          {pending && <span className="text-xs text-muted-foreground/70">…</span>}
        </div>
      </div>

      {/* The list, or the right empty state. */}
      {childArray.length === 0 ? (
        <Empty
          message={emptyAll ? t("queue_empty_all") : t("queue_empty_filtered")}
        />
      ) : visible.length === 0 ? (
        <Empty message={t("queue_empty_search")} />
      ) : (
        <ul className="space-y-2">{visible}</ul>
      )}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <BookOpen className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
