"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { ClientsToolbar } from "./clients-toolbar";
import {
  ClientsTable,
  type ClientEngagementRow,
  type ClientEngagementSummary,
  type ClientRelationshipBadge,
} from "./clients-table";
import type { Client } from "@/lib/db/clients";
import type { SortKey } from "./sort";
import type { ClientOwner } from "./owner";
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
  owners,
  currentUserId,
  ownerFilter,
  locale,
  type,
  includeArchived,
  sort,
  activeOnly,
  teamEnabled,
  relationships,
  title,
  subtitle,
  actions,
}: {
  clients: Client[];
  summaries: Record<string, ClientEngagementSummary>;
  engagementsByClient: Record<string, ClientEngagementRow[]>;
  owners: Record<string, ClientOwner>;
  relationships?: Record<string, ClientRelationshipBadge>;
  currentUserId: string;
  // "all" | "mine" | a specific member id.
  ownerFilter: string;
  locale: AppLocale;
  type: "all" | "individual" | "business";
  includeArchived: boolean;
  sort: SortKey;
  activeOnly: boolean;
  teamEnabled: boolean;
  // The page HEADER is rendered here rather than in the page, because the
  // search box belongs in it and the query is CLIENT state — the whole list is
  // already loaded, so filtering is instant and must not become a server
  // round-trip per keystroke just to reach the header. `actions` carries the
  // server-rendered Import / Add client buttons straight through.
  title: string;
  subtitle: string;
  actions: React.ReactNode;
  // Teammates (excluding the viewer) for the owner filter's per-person options.
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
    <div className="space-y-4">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-[26px] font-[650] tracking-[-0.02em]">{title}</h1>
          <p className="mt-[5px] text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search_placeholder")}
              aria-label={t("search_label")}
              className="h-[42px] w-full rounded-[11px] border border-border bg-card pr-3.5 pl-9 text-sm text-foreground shadow-[0_1px_2px_rgba(10,10,20,0.03)] transition-colors placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-[320px]"
            />
          </div>
          {actions}
        </div>
      </header>

      <ClientsToolbar
        query={query}
        onQueryChange={setQuery}
        type={type}
        includeArchived={includeArchived}
        sort={sort}
        activeOnly={activeOnly}
        ownerFilter={ownerFilter}
        teamEnabled={teamEnabled}
      />
      {filtered.length === 0 && clients.length > 0 ? (
        // Live-filter empty state: the firm has clients but none
        // match the search box. Distinct from the page-level "you
        // haven't added any clients" empty state, which the existing
        // ClientsTable already handles when `clients` is empty.
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t("empty_search")}
        </div>
      ) : (
        <ClientsTable
          clients={filtered}
          summaries={summaries}
          engagementsByClient={engagementsByClient}
          owners={owners}
          currentUserId={currentUserId}
          locale={locale}
          teamEnabled={teamEnabled}
          relationships={relationships}
        />
      )}
    </div>
  );
}
