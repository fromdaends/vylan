"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ClientsToolbar } from "./clients-toolbar";
import {
  ClientsTable,
  type ClientEngagementRow,
  type ClientEngagementSummary,
} from "./clients-table";
import type { Client } from "@/lib/db/clients";
import type { SortKey } from "./sort";
import type { AppLocale } from "@/lib/format";

// Holds the in-memory search state shared between the toolbar's
// search input and the rendered table. The other filters
// (type / sort / activeOnly / includeArchived) still round-trip
// through the URL — the server pre-filters and pre-sorts by those,
// so this view only needs to apply the live text filter on top.
//
// No debounce, no server fetch, no loading state: the filter runs
// on every keystroke against the already-loaded clients prop.
export function ClientsListView({
  clients,
  summaries,
  engagementsByClient,
  locale,
  type,
  includeArchived,
  sort,
  activeOnly,
}: {
  clients: Client[];
  summaries: Record<string, ClientEngagementSummary>;
  engagementsByClient: Record<string, ClientEngagementRow[]>;
  locale: AppLocale;
  type: "all" | "individual" | "business";
  includeArchived: boolean;
  sort: SortKey;
  activeOnly: boolean;
}) {
  const t = useTranslations("Clients");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return clients;
    return clients.filter((c) => {
      const inName = c.display_name.toLowerCase().includes(trimmed);
      const inEmail =
        c.email != null && c.email.toLowerCase().includes(trimmed);
      return inName || inEmail;
    });
  }, [clients, query]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60">
        <ClientsToolbar
          query={query}
          onQueryChange={setQuery}
          type={type}
          includeArchived={includeArchived}
          sort={sort}
          activeOnly={activeOnly}
        />
      </div>
      {filtered.length === 0 && clients.length > 0 ? (
        // Live-filter empty state: the firm has clients but none
        // match the search box. Distinct from the page-level "you
        // haven't added any clients" empty state, which the existing
        // ClientsTable already handles when `clients` is empty.
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          {t("empty_search")}
        </div>
      ) : (
        <ClientsTable
          clients={filtered}
          summaries={summaries}
          engagementsByClient={engagementsByClient}
          locale={locale}
        />
      )}
    </div>
  );
}
