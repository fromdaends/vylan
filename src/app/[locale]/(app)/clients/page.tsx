import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { listClients } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ClientsToolbar } from "@/components/clients/clients-toolbar";
import {
  ClientsTable,
  type ClientEngagementSummary,
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

  const [clients, engagements] = await Promise.all([
    listClients({ search: q, type, includeArchived }),
    listEngagements(),
  ]);

  // Group engagement counts by client_id.
  const summaries: Record<string, ClientEngagementSummary> = {};
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
  }

  const t = await getTranslations("Clients");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("count", { count: clients.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/clients/import">
            <Button variant="outline" size="sm">
              <Upload className="size-4" />
              {t("import_csv")}
            </Button>
          </Link>
          <ClientFormDialog mode="create" locale={locale} />
        </div>
      </header>

      <Suspense>
        <ClientsToolbar q={q} type={type} includeArchived={includeArchived} />
      </Suspense>

      <ClientsTable
        clients={clients}
        summaries={summaries}
        locale={locale}
      />
    </div>
  );
}
