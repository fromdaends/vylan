import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { listClients, type Client } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";

// Real-time data: never serve a cached version after Mark complete /
// archive / etc.
export const dynamic = "force-dynamic";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ClientsToolbar, SORT_OPTIONS, type SortKey } from "@/components/clients/clients-toolbar";
import {
  ClientsTable,
  type ClientEngagementSummary,
  type ClientEngagementRow,
} from "@/components/clients/clients-table";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { assertLocale } from "@/lib/locale";
import { Upload } from "lucide-react";

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    type?: string;
    archived?: string;
    sort?: string;
    active?: string;
  }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const q = (sp.q ?? "").trim();
  const type =
    sp.type === "individual" || sp.type === "business" ? sp.type : "all";
  const includeArchived = sp.archived === "1";
  const sort: SortKey = SORT_OPTIONS.includes(sp.sort as SortKey)
    ? (sp.sort as SortKey)
    : "recent";
  const activeOnly = sp.active === "1";

  const [clientsRaw, engagements] = await Promise.all([
    listClients({ search: q, type, includeArchived }),
    listEngagements(),
  ]);

  // Group engagement counts by client_id (for the summary badge in the
  // row's "Engagements" column) AND group the full engagement rows by
  // client_id so the expanded drawer can list them without another
  // fetch. Single pass over the engagements array.
  const summaries: Record<string, ClientEngagementSummary> = {};
  const engagementsByClient: Record<string, ClientEngagementRow[]> = {};
  for (const e of engagements) {
    const s =
      summaries[e.client_id] ??
      ({
        draft: 0,
        sent: 0,
        in_progress: 0,
        complete: 0,
        cancelled: 0,
        total_live: 0,
      } as ClientEngagementSummary);
    s[e.status] += 1;
    if (e.status === "sent" || e.status === "in_progress") s.total_live += 1;
    summaries[e.client_id] = s;

    const list = engagementsByClient[e.client_id] ?? [];
    list.push({
      id: e.id,
      title: e.title,
      type: e.type,
      status: e.status,
      due_date: e.due_date,
    });
    engagementsByClient[e.client_id] = list;
  }
  // Sort each client's engagements: live first (sent / in_progress),
  // then drafts, then completed, then cancelled. Within a status group,
  // newest first by id (ids are uuids but listEngagements already
  // returns newest first, so we just preserve insertion order in each
  // status bucket).
  const STATUS_RANK: Record<string, number> = {
    in_progress: 0,
    sent: 1,
    draft: 2,
    complete: 3,
    cancelled: 4,
  };
  for (const id of Object.keys(engagementsByClient)) {
    engagementsByClient[id].sort(
      (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
    );
  }

  // Last-activity timestamp per client = newest engagement created_at
  // for that client. Used by the `most_active` sort. Engagements are
  // already newest-first from listEngagements, so the first one wins.
  const lastActivityByClient: Record<string, string> = {};
  for (const e of engagements) {
    if (!(e.client_id in lastActivityByClient)) {
      lastActivityByClient[e.client_id] = e.created_at;
    }
  }

  // Apply the "Active only" filter — only clients with at least one
  // engagement in sent / in_progress (= total_live > 0).
  let clients: Client[] = clientsRaw;
  if (activeOnly) {
    clients = clients.filter((c) => (summaries[c.id]?.total_live ?? 0) > 0);
  }

  // Apply sort. listClients already returns newest-first, so `recent`
  // is a no-op pass-through.
  clients = sortClients(
    clients,
    sort,
    summaries,
    lastActivityByClient,
    locale,
  );

  const t = await getTranslations("Clients");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-in-up">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 font-mono tabular-nums">
            {t("count", { count: clients.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/clients/import">
            <Button variant="ghost" size="sm">
              <Upload className="h-4 w-4" />
              {t("import_csv")}
            </Button>
          </Link>
          <ClientFormDialog mode="create" locale={locale} />
        </div>
      </header>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60">
          <Suspense>
            <ClientsToolbar
              q={q}
              type={type}
              includeArchived={includeArchived}
              sort={sort}
              activeOnly={activeOnly}
            />
          </Suspense>
        </div>
        <ClientsTable
          clients={clients}
          summaries={summaries}
          engagementsByClient={engagementsByClient}
          locale={locale}
        />
      </div>
    </div>
  );
}

function sortClients(
  clients: Client[],
  sort: SortKey,
  summaries: Record<string, ClientEngagementSummary>,
  lastActivityByClient: Record<string, string>,
  locale: "fr" | "en",
): Client[] {
  // localeCompare gives us a sensible alphabetical order for French
  // accents (Étienne vs Etienne) without rebuilding the strings.
  const collator = new Intl.Collator(locale === "fr" ? "fr-CA" : "en-CA", {
    sensitivity: "base",
  });
  const out = [...clients];
  switch (sort) {
    case "recent":
      // listClients already sorts by created_at desc — keep as-is.
      break;
    case "oldest":
      out.sort((a, b) => a.created_at.localeCompare(b.created_at));
      break;
    case "name_asc":
      out.sort((a, b) => collator.compare(a.display_name, b.display_name));
      break;
    case "name_desc":
      out.sort((a, b) => collator.compare(b.display_name, a.display_name));
      break;
    case "most_engagements": {
      // Sum all statuses (not just live) so a client with 5 completed
      // engagements out-ranks one with 1 active. Tie-breaker: newest
      // client first so freshly-imported tied clients bubble up.
      const total = (id: string) => {
        const s = summaries[id];
        if (!s) return 0;
        return s.draft + s.sent + s.in_progress + s.complete + s.cancelled;
      };
      out.sort((a, b) => {
        const d = total(b.id) - total(a.id);
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      });
      break;
    }
    case "most_active": {
      // Newest engagement activity wins. Clients with no engagements at
      // all sink to the bottom (treated as epoch).
      const ts = (id: string) => lastActivityByClient[id] ?? "";
      out.sort((a, b) => {
        const d = ts(b.id).localeCompare(ts(a.id));
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      });
      break;
    }
  }
  return out;
}
