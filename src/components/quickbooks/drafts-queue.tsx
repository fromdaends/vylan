"use client";

import { Children, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  Search,
  BookOpen,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
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
  sortedQueueIndexes,
  type QueueFilter,
  type QueueCounts,
  type QueueSortDir,
  type QueueSortKey,
  type QueueSortMeta,
} from "@/lib/quickbooks/draft-queue";
import { ApproveReadyButton } from "./approve-ready-button";
import { PostApprovedButton } from "./post-approved-button";

// Firm-wide QuickBooks drafts queue (Stage 4, Phase 3) — the client shell.
// Status + client filters round-trip via the URL (server re-filters + re-renders
// the rows). Text search is an instant client-side filter over the rows already
// rendered, matched against a parallel `searchIndex` (same order as `children`).
export function DraftsQueue({
  counts,
  readyCount,
  postableCount,
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
  // Approved expense drafts matching the client filter — drives "Post all approved".
  postableCount: number;
  totalCad: number | null;
  hasForeignCurrency: boolean;
  activeFilter: QueueFilter;
  activeClient: string | null;
  clients: { id: string; name: string }[];
  locale: AppLocale;
  // Parallel to `children` — { id, lowercased searchable text } per row, plus
  // what each row sorts on.
  searchIndex: { id: string; text: string; sort: QueueSortMeta }[];
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
  // null = the server's own priority order (needs-input first). Clicking a
  // column sorts by it; clicking the same one again flips the direction.
  const [sort, setSort] = useState<{
    key: QueueSortKey;
    dir: QueueSortDir;
  } | null>(null);

  function toggleSort(key: QueueSortKey) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "amount" ? "desc" : "asc" },
    );
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search?.toString() ?? "");
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  // Filter by the instant text search, then order by the chosen column
  // (children order == searchIndex order, so positions index both).
  const childArray = useMemo(() => Children.toArray(children), [children]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const kept = childArray
      .map((child, i) => ({ child, i }))
      .filter(({ i }) => !q || (searchIndex[i]?.text.includes(q) ?? false));
    const order = sortedQueueIndexes(
      kept.map(({ i }) => searchIndex[i]?.sort).filter((m) => m != null),
      sort,
    );
    return order.map((pos) => kept[pos]!.child);
  }, [childArray, searchIndex, q, sort]);

  const filterLabel: Record<QueueFilter, string> = {
    all: t("queue_filter_all"),
    needs_input: t("bucket_needs_input"),
    ready: t("bucket_ready"),
    approved: t("status_approved"),
    posted: t("status_posted"),
    dismissed: t("status_dismissed"),
  };
  const filterCount: Record<QueueFilter, number> = {
    // "All" means literally every draft, posted + dismissed included (each has
    // its own chip too). Matches matchesQueueFilter("all") = show everything.
    all: counts.total,
    needs_input: counts.needs_input,
    ready: counts.ready,
    approved: counts.approved,
    posted: counts.posted,
    dismissed: counts.dismissed,
  };

  return (
    <div className="space-y-3">
      {/* Count + running total. This used to be its own bordered, filled strip,
          which inside the page's Canopy panel made a box within a box; it's a
          plain line of text now — the panel is the box. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-foreground">
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
          <PostApprovedButton postableCount={postableCount} client={activeClient} />
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

      {/* The table, or the right empty state. Rows were a stack of bordered
          cards; one table with real column headers reads as a ledger and lets
          the columns be sorted. Scrolls sideways rather than squashing. */}
      {childArray.length === 0 ? (
        <Empty
          message={emptyAll ? t("queue_empty_all") : t("queue_empty_filtered")}
        />
      ) : visible.length === 0 ? (
        <Empty message={t("queue_empty_search")} />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/60">
                {/* Source logo — no header text worth the width. */}
                <th scope="col" className="w-10 pb-2 pl-3" />
                <SortHeader
                  label={t("queue_col_client")}
                  sortKey="client"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortHeader
                  label={t("queue_col_document")}
                  sortKey="document"
                  sort={sort}
                  onSort={toggleSort}
                  className="hidden md:table-cell"
                />
                <SortHeader
                  label={t("queue_col_amount")}
                  sortKey="amount"
                  sort={sort}
                  onSort={toggleSort}
                  align="right"
                />
                <SortHeader
                  label={t("queue_col_status")}
                  sortKey="status"
                  sort={sort}
                  onSort={toggleSort}
                />
                {/* Hover actions + the expand chevron. */}
                <th scope="col" className="pb-2" />
                <th scope="col" className="w-9 pb-2 pr-2" />
              </tr>
            </thead>
            <tbody>{visible}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// One sortable column heading: click to sort, click again to flip. The arrow
// only appears on the active column, so the header row stays quiet.
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  sortKey: QueueSortKey;
  sort: { key: QueueSortKey; dir: QueueSortDir } | null;
  onSort: (key: QueueSortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      scope="col"
      // aria-sort is what a screen reader announces; the arrow is the sighted
      // half of the same information.
      aria-sort={
        active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn("pb-2 pr-3 font-normal", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          align === "right" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          sort!.dir === "asc" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-0 transition-opacity group-hover/th:opacity-40" aria-hidden />
        )}
      </button>
    </th>
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
