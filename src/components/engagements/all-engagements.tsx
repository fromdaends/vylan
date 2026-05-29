"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  WorklistTable,
  type WorklistRow,
} from "@/components/dashboard/engagements-worklist";
import type { AppLocale } from "@/lib/format";

// The full "Browse all" engagements list (every status), behind /engagements.
// Reuses the dashboard's WorklistTable; adds a search box and sorts newest
// first. Distinct from the dashboard worklist (which has the Recent/Mine
// tabs) — this is the unfiltered everything view.
export function AllEngagements({
  rows,
  locale,
}: {
  rows: WorklistRow[];
  locale: AppLocale;
}) {
  const t = useTranslations("Dashboard");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const base =
      q === ""
        ? rows
        : rows.filter(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.clientName.toLowerCase().includes(q),
          );
    return [...base].sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
  }, [rows, q]);

  return (
    <div className="space-y-4">
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
      <WorklistTable
        rows={visible}
        locale={locale}
        emptyText={q !== "" ? t("wl_empty_search") : t("wl_empty_all")}
      />
    </div>
  );
}
