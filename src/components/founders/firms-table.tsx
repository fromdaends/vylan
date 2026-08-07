"use client";

// EVERY FIRM ON THE PLATFORM, one row each — the answer to "how are our clients
// doing", which is the question the console was asked for.
//
// Sorting lives IN the table (click a header), not in a control strip above it.
// That is the pattern the engagements list settled on for a good reason: a page
// that owns the sort can only sort the one list it knows about, and every list
// built from the shared table then loses the feature.
//
// NO EARLY RETURN ON AN EMPTY RESULT. The headers ARE the controls here — the
// search box and the demo toggle sit in the same block — so replacing the whole
// thing with "no matches" would remove the way back. The empty state goes in
// the tbody.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import {
  filterFirmRows,
  formatCents,
  formatMinutes,
  relativeAge,
  sortFirmRows,
  type FirmSortKey,
} from "@/lib/founders/aggregate";
import type { FirmRow } from "@/lib/founders/types";
import { PinButton } from "@/components/founders/pin-button";

type Column = {
  key: FirmSortKey;
  labelKey: string;
  align: "left" | "right";
  render: (row: FirmRow, nowMs: number) => React.ReactNode;
  /** Hidden below xl — the columns you scan on a laptop stay, the rest appear
   *  on a wide screen rather than forcing a horizontal scroll on every one. */
  wide?: boolean;
};

const COLUMNS: Column[] = [
  { key: "users", labelKey: "col_people", align: "right", render: (r) => r.activeUsers },
  { key: "clients", labelKey: "col_clients", align: "right", render: (r) => r.activeClients },
  {
    key: "engagements",
    labelKey: "col_engagements",
    align: "right",
    render: (r) => (
      <span title={`${r.activeEngagements} active · ${r.completedEngagements} complete`}>
        {r.engagements}
      </span>
    ),
  },
  { key: "documents", labelKey: "col_documents", align: "right", render: (r) => r.documents },
  {
    key: "invoicedCents",
    labelKey: "col_invoiced",
    align: "right",
    wide: true,
    render: (r) => (r.invoicedCents > 0 ? formatCents(r.invoicedCents) : "—"),
  },
  {
    key: "paidCents",
    labelKey: "col_collected",
    align: "right",
    render: (r) => (r.paidCents > 0 ? formatCents(r.paidCents) : "—"),
  },
  {
    key: "timeMinutes",
    labelKey: "col_time",
    align: "right",
    wide: true,
    render: (r) => formatMinutes(r.timeMinutes),
  },
  { key: "events30d", labelKey: "col_events", align: "right", render: (r) => r.events30d },
  {
    key: "lastActivityAt",
    labelKey: "col_last_active",
    align: "right",
    render: (r, nowMs) => (
      <span
        title={r.lastActivityAt ?? undefined}
        className={cn(!r.lastActivityAt && "text-muted-foreground")}
      >
        {relativeAge(r.lastActivityAt, nowMs)}
      </span>
    ),
  },
];

export function FirmsTable({
  rows,
  nowMs,
  pinsAvailable = false,
}: {
  rows: FirmRow[];
  nowMs: number;
  pinsAvailable?: boolean;
}) {
  const t = useTranslations("Founders");
  const [query, setQuery] = useState("");
  const [includeDemo, setIncludeDemo] = useState(true);
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [sortKey, setSortKey] = useState<FirmSortKey>("events30d");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const visible = useMemo(() => {
    let base = includeDemo ? rows : rows.filter((r) => !r.isDemo);
    if (onlyPinned) base = base.filter((r) => r.pinned);
    return sortFirmRows(filterFirmRows(base, query), sortKey, dir);
  }, [rows, query, includeDemo, onlyPinned, sortKey, dir]);

  const demoCount = rows.filter((r) => r.isDemo).length;
  const pinnedCount = rows.filter((r) => r.pinned).length;

  function toggleSort(key: FirmSortKey) {
    if (key === sortKey) {
      setDir(dir === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(key);
    // A newly picked column opens on the interesting end: biggest first for a
    // number, oldest-last for a name.
    setDir(key === "name" ? "asc" : "desc");
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 border-b border-border/60 py-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("firms_search_placeholder")}
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center gap-3">
          {/* Only offered once something IS pinned — a "tracking only" filter
              that can only ever produce an empty table is a trap, not a
              control. */}
          {pinsAvailable && pinnedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyPinned}
                onChange={(e) => setOnlyPinned(e.target.checked)}
                className="size-3.5 accent-[var(--accent)]"
              />
              {t("firms_only_pinned", { count: pinnedCount })}
            </label>
          )}
          {demoCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeDemo}
                onChange={(e) => setIncludeDemo(e.target.checked)}
                className="size-3.5 accent-[var(--accent)]"
              />
              {t("firms_include_demo", { count: demoCount })}
            </label>
          )}
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("firms_count", { count: visible.length })}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <SortHeader
                label={t("col_firm")}
                active={sortKey === "name"}
                dir={dir}
                onClick={() => toggleSort("name")}
                align="left"
              />
              {COLUMNS.map((c) => (
                <SortHeader
                  key={c.key}
                  label={t(c.labelKey)}
                  active={sortKey === c.key}
                  dir={dir}
                  onClick={() => toggleSort(c.key)}
                  align={c.align}
                  wide={c.wide}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0 ? t("firms_empty") : t("firms_no_matches")}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="group border-b border-border/50 hover:bg-muted/40">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5">
                      <PinButton
                        firmId={row.id}
                        firmName={row.name}
                        pinned={row.pinned}
                        available={pinsAvailable}
                      />
                      <Link
                        href={`/founders/firms/${row.id}`}
                        className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.name}
                      </Link>
                      <PlanBadge plan={row.plan} />
                      {row.isDemo && <Tag label={t("tag_demo")} />}
                      {row.isPilot && <Tag label={t("tag_pilot")} />}
                    </div>
                    {/* Indented to clear the pin, so the two lines of the cell
                        line up with each other rather than with the icon. */}
                    <p className={cn("text-xs text-muted-foreground", pinsAvailable && "pl-7.5")}>
                      {t("firms_joined", { age: relativeAge(row.createdAt, nowMs) })}
                      {!row.onboardedAt && ` · ${t("tag_not_onboarded")}`}
                    </p>
                  </td>
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "py-2 pl-3 tabular-nums",
                        c.align === "right" && "text-right",
                        c.wide && "hidden xl:table-cell",
                      )}
                    >
                      {c.render(row, nowMs)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
  wide,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align: "left" | "right";
  wide?: boolean;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "py-2 font-medium",
        align === "right" ? "pl-3 text-right" : "pr-3 text-left",
        wide && "hidden xl:table-cell",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
        )}
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          ))}
      </button>
    </th>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
      {plan}
    </span>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="rounded bg-secondary px-1.5 py-px text-[10px] uppercase tracking-wide text-secondary-foreground">
      {label}
    </span>
  );
}
