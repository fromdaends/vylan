import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { listEngagements } from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { Plus } from "lucide-react";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [firm, engagements, clients] = await Promise.all([
    getCurrentFirm(),
    listEngagements(),
    listClients(),
  ]);
  const t = await getTranslations("App");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");

  const active = engagements.filter(
    (e) => e.status === "sent" || e.status === "in_progress",
  );
  const drafts = engagements.filter((e) => e.status === "draft");
  const completed = engagements.filter((e) => e.status === "complete");
  const recent = engagements.slice(0, 8);

  const clientsById = new Map(clients.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("dashboard_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{firm?.name}</p>
        </div>
        <Link href="/engagements/new">
          <Button size="sm">
            <Plus className="size-4" />
            {tEng("new")}
          </Button>
        </Link>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Metric label={t("metric_clients")} value={clients.length} />
        <Metric label={t("metric_active")} value={active.length} />
        <Metric label={t("metric_drafts")} value={drafts.length} />
        <Metric label={t("metric_completed")} value={completed.length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("recent_engagements")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("dashboard_empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((e) => (
                <li key={e.id} className="py-3">
                  <Link
                    href={`/engagements/${e.id}`}
                    className="flex items-center justify-between gap-3 hover:text-foreground"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {clientsById.get(e.client_id)?.display_name ?? "—"}
                        {e.due_date && ` · ${e.due_date}`}
                      </div>
                    </div>
                    <Badge variant={statusVariant(e.status)}>
                      {tStatus(e.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "complete") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "draft") return "outline";
  return "secondary";
}
