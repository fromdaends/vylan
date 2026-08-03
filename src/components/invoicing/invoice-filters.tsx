"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Check, ListFilter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import {
  billingHref,
  hasAnyFilter,
  INVOICE_STATUS_FILTERS,
  type InvoiceListFilters,
} from "@/lib/invoices/tabs";

// ONE control — "Sort & filter" — instead of four boxes strung across the top.
//
// The old bar put a status select, a client select and two date inputs on
// permanent display, which is four controls shouting at a screen whose actual
// job is the table underneath. They are all still here, one click away, and
// what is ACTIVE is stated in plain words to the right of the button. Nothing
// silently narrows the list: an invisible filter reads as "my invoices
// disappeared", which is the bug this shape has to avoid.
//
// Every item navigates rather than setting state, so a filtered view stays a
// real URL — linkable, refreshable, back-buttonable.
//
// NOTE: no "Sort by" section, though the handoff draws one. The invoice list
// has no sort parameter — it is issued-date descending in SQL — so the menu
// would offer choices that change nothing. Sorting is a feature to add to the
// query, not a control to draw.

/** Local YYYY-MM-DD. `toISOString` would shift the day across a timezone. */
function day(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function InvoiceFilters({
  filters,
  clients,
}: {
  filters: InvoiceListFilters;
  clients: { id: string; name: string }[];
}) {
  const t = useTranslations("FirmBilling");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (change: Partial<InvoiceListFilters>) => {
    startTransition(() => router.push(billingHref(filters, change)));
  };

  const now = new Date();
  const last30 = new Date(now);
  last30.setDate(last30.getDate() - 30);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const periods = [
    { key: "all", label: t("filter_period_all"), from: null, to: null },
    { key: "30", label: t("filter_period_30"), from: day(last30), to: null },
    { key: "month", label: t("filter_period_month"), from: day(monthStart), to: null },
  ] as const;
  const activePeriod =
    filters.from == null && filters.to == null
      ? "all"
      : (periods.find((p) => p.from === filters.from && filters.to == null)?.key ??
        "custom");

  // What is narrowing the list, in words. The count on the button says HOW
  // MANY; this says WHICH — a bare "2" tells you something is on but not what.
  const activeCount =
    (filters.status !== "all" ? 1 : 0) +
    (filters.clientId ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0);
  const summaryParts: string[] = [];
  if (filters.status !== "all") summaryParts.push(t(`status_${filters.status}`));
  if (filters.clientId) {
    summaryParts.push(
      clients.find((c) => c.id === filters.clientId)?.name ?? t("filter_client"),
    );
  }
  if (activePeriod === "30") summaryParts.push(t("filter_period_30"));
  else if (activePeriod === "month") summaryParts.push(t("filter_period_month"));
  else if (filters.from || filters.to) summaryParts.push(t("filter_period_custom"));

  const check = (on: boolean) => (
    <Check
      className={cn("size-3.5 text-accent", on ? "opacity-100" : "opacity-0")}
      aria-hidden
    />
  );

  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 gap-2 rounded-[9px] px-3.5 text-[13.5px] font-medium"
            >
              <ListFilter className="size-3.5 text-muted-foreground" aria-hidden />
              {t("filter_button")}
              {activeCount > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[5px] text-[11px] font-semibold text-accent-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[420px] w-62 overflow-y-auto p-1.5"
          >
            <DropdownMenuLabel className="text-[10.5px] font-semibold tracking-[0.07em] uppercase text-muted-foreground">
              {t("filter_status")}
            </DropdownMenuLabel>
            {INVOICE_STATUS_FILTERS.map((s) => (
              <DropdownMenuItem
                key={s}
                className="gap-2 rounded-[7px] text-[13px]"
                onSelect={() => go({ status: s })}
              >
                {check(filters.status === s)}
                {s === "all" ? t("filter_status_all") : t(`status_${s}`)}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10.5px] font-semibold tracking-[0.07em] uppercase text-muted-foreground">
              {t("filter_client")}
            </DropdownMenuLabel>
            <DropdownMenuItem
              className="gap-2 rounded-[7px] text-[13px]"
              onSelect={() => go({ clientId: null })}
            >
              {check(!filters.clientId)}
              {t("filter_client_all")}
            </DropdownMenuItem>
            {clients.map((c) => (
              <DropdownMenuItem
                key={c.id}
                className="gap-2 rounded-[7px] text-[13px]"
                onSelect={() => go({ clientId: c.id })}
              >
                {check(filters.clientId === c.id)}
                <span className="min-w-0 truncate">{c.name}</span>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10.5px] font-semibold tracking-[0.07em] uppercase text-muted-foreground">
              {t("filter_period")}
            </DropdownMenuLabel>
            {periods.map((p) => (
              <DropdownMenuItem
                key={p.key}
                className="gap-2 rounded-[7px] text-[13px]"
                onSelect={() => go({ from: p.from, to: p.to })}
              >
                {check(activePeriod === p.key)}
                {p.label}
              </DropdownMenuItem>
            ))}

            {/* The exact range stays reachable — a client STATEMENT is built
                from whatever window is set here, and "last 30 days" is not the
                window an accountant sends a client. Kept inside the menu so it
                is available without occupying the screen. onSelect is
                suppressed or the menu closes on the first click into a field. */}
            <div
              className="mt-1 grid grid-cols-2 gap-1.5 border-t border-border/60 px-1.5 pt-2"
              onClick={(e) => e.stopPropagation()}
            >
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("filter_from")}
                </span>
                <Input
                  type="date"
                  value={filters.from ?? ""}
                  onChange={(e) => go({ from: e.target.value || null })}
                  className="h-8 text-[12.5px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("filter_to")}
                </span>
                <Input
                  type="date"
                  value={filters.to ?? ""}
                  onChange={(e) => go({ to: e.target.value || null })}
                  className="h-8 text-[12.5px]"
                />
              </label>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {hasAnyFilter(filters) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            className="h-9 gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground"
            onClick={() => startTransition(() => router.push("/billing"))}
          >
            <X className="size-3.5" />
            {t("filter_clear")}
          </Button>
        )}
      </div>

      {summaryParts.length > 0 && (
        <span className="text-[12.5px] text-muted-foreground">
          {t("filter_active", { list: summaryParts.join(" · ") })}
        </span>
      )}
    </div>
  );
}
