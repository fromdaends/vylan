"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  billingHref,
  hasAnyFilter,
  INVOICE_STATUS_FILTERS,
  type InvoiceListFilters,
} from "@/lib/invoices/tabs";

// The filter bar. Every control navigates rather than setting state, so the
// filtered view is a real URL — linkable, refreshable, and back-buttonable.
// Only the search box is local state, because typing should not fire a
// navigation per keystroke; it commits on Enter or blur.
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
  const [search, setSearch] = useState(filters.search ?? "");

  const go = (change: Partial<InvoiceListFilters>) => {
    startTransition(() => router.push(billingHref(filters, change)));
  };

  const commitSearch = () => {
    const next = search.trim() || null;
    if (next === filters.search) return; // no navigation for a no-op blur
    go({ search: next });
  };

  return (
    <div className="mb-3.5 flex flex-wrap items-end gap-2">
      {/* The page HEADER owns the one search box now. Two inputs writing the
          same ?q= would fight each other. */}
      <div className="relative hidden min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitSearch();
            }
          }}
          placeholder={t("filter_search")}
          aria-label={t("filter_search")}
          className="pl-8"
        />
      </div>

      <Select
        value={filters.status}
        onValueChange={(v) =>
          go({ status: v as InvoiceListFilters["status"] })
        }
      >
        <SelectTrigger className="w-[168px]" aria-label={t("filter_status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INVOICE_STATUS_FILTERS.map((s) => (
            <SelectItem key={s} value={s}>
              {s === "all" ? t("filter_status_all") : t(`status_${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.clientId ?? "all"}
        onValueChange={(v) => go({ clientId: v === "all" ? null : v })}
      >
        <SelectTrigger className="w-[180px]" aria-label={t("filter_client")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filter_client_all")}</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-end gap-1.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            {t("filter_from")}
          </span>
          <Input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => go({ from: e.target.value || null })}
            className="w-[148px]"
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
            className="w-[148px]"
          />
        </label>
      </div>

      {hasAnyFilter(filters) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setSearch("");
            startTransition(() => router.push("/billing"));
          }}
        >
          <X className="mr-1 size-3.5" />
          {t("filter_clear")}
        </Button>
      )}
    </div>
  );
}
